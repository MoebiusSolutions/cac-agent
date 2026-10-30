# Run with Windows PowerShell 5.1 or later. Uses the Windows System.Drawing API;
# no image-processing packages are required. Artwork is only resized/encoded.
[CmdletBinding()]
param(
    [string]$SourcePath,
    [string]$OutputDirectory
)

$ErrorActionPreference = 'Stop'
# Resolve defaults after parameter binding: Windows PowerShell can evaluate
# default parameter expressions before populating $PSScriptRoot.
$scriptDirectory = $PSScriptRoot
if ([string]::IsNullOrWhiteSpace($scriptDirectory)) {
    $scriptDirectory = [System.IO.Path]::GetDirectoryName($MyInvocation.MyCommand.Path)
}
if ([string]::IsNullOrWhiteSpace($scriptDirectory)) {
    throw 'Cannot determine the export script directory. Run this script with PowerShell -File.'
}
if ([string]::IsNullOrWhiteSpace($SourcePath)) {
    $SourcePath = Join-Path $scriptDirectory '..\assets\icon-master.png'
}
if ([string]::IsNullOrWhiteSpace($OutputDirectory)) {
    $OutputDirectory = Join-Path $scriptDirectory '..\assets'
}
Add-Type -AssemblyName System.Drawing

function Get-ResizedPng {
    param(
        [System.Drawing.Image]$Source,
        [int]$Size
    )

    $bitmap = [System.Drawing.Bitmap]::new(
        $Size, $Size, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb
    )
    $graphics = $null
    $attributes = $null
    $stream = $null
    try {
        $graphics = [System.Drawing.Graphics]::FromImage($bitmap)
        $graphics.CompositingMode = [System.Drawing.Drawing2D.CompositingMode]::SourceCopy
        $graphics.CompositingQuality = [System.Drawing.Drawing2D.CompositingQuality]::HighQuality
        $graphics.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
        $graphics.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::HighQuality
        $graphics.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
        $attributes = [System.Drawing.Imaging.ImageAttributes]::new()
        $attributes.SetWrapMode([System.Drawing.Drawing2D.WrapMode]::TileFlipXY)
        $rectangle = [System.Drawing.Rectangle]::new(0, 0, $Size, $Size)
        $graphics.DrawImage(
            $Source, $rectangle, 0, 0, $Source.Width, $Source.Height,
            [System.Drawing.GraphicsUnit]::Pixel, $attributes
        )
        $stream = [System.IO.MemoryStream]::new()
        $bitmap.Save($stream, [System.Drawing.Imaging.ImageFormat]::Png)
        return ,$stream.ToArray()
    } finally {
        if ($stream) { $stream.Dispose() }
        if ($attributes) { $attributes.Dispose() }
        if ($graphics) { $graphics.Dispose() }
        $bitmap.Dispose()
    }
}

function Write-BigEndian32 {
    param([System.IO.Stream]$Stream, [uint32]$Value)
    $bytes = [System.BitConverter]::GetBytes($Value)
    if ([System.BitConverter]::IsLittleEndian) { [Array]::Reverse($bytes) }
    $Stream.Write($bytes, 0, $bytes.Length)
}

$resolvedSource = (Resolve-Path -LiteralPath $SourcePath).ProviderPath
$output = [System.IO.Path]::GetFullPath($OutputDirectory)
if ($resolvedSource -eq (Join-Path $output 'icon.png')) {
    throw 'Use a separate source filename, such as icon-master.png, to preserve the original artwork.'
}
[System.IO.Directory]::CreateDirectory($output) | Out-Null
$iconset = Join-Path $output 'icon.iconset'
[System.IO.Directory]::CreateDirectory($iconset) | Out-Null

$image = [System.Drawing.Image]::FromFile($resolvedSource)
try {
    if ($image.Width -ne $image.Height -or $image.Width -lt 1024) {
        throw 'The master icon must be square and at least 1024 x 1024 pixels.'
    }
    $pngBySize = @{}
    foreach ($size in @(16, 20, 24, 32, 40, 48, 64, 128, 256, 512, 1024)) {
        $pngBySize[$size] = Get-ResizedPng -Source $image -Size $size
    }
} finally {
    $image.Dispose()
}

# Linux launcher image and a native macOS iconset (normal and Retina sizes).
[System.IO.File]::WriteAllBytes((Join-Path $output 'icon.png'), $pngBySize[1024])
$iconsetEntries = @(
    @{ Name = 'icon_16x16.png'; Size = 16 },
    @{ Name = 'icon_16x16@2x.png'; Size = 32 },
    @{ Name = 'icon_32x32.png'; Size = 32 },
    @{ Name = 'icon_32x32@2x.png'; Size = 64 },
    @{ Name = 'icon_128x128.png'; Size = 128 },
    @{ Name = 'icon_128x128@2x.png'; Size = 256 },
    @{ Name = 'icon_256x256.png'; Size = 256 },
    @{ Name = 'icon_256x256@2x.png'; Size = 512 },
    @{ Name = 'icon_512x512.png'; Size = 512 },
    @{ Name = 'icon_512x512@2x.png'; Size = 1024 }
)
foreach ($entry in $iconsetEntries) {
    [System.IO.File]::WriteAllBytes((Join-Path $iconset $entry.Name), $pngBySize[$entry.Size])
}

# ICO: little-endian directory followed by PNG frames (Windows Vista+).
$icoSizes = @(16, 20, 24, 32, 40, 48, 64, 128, 256)
$icoStream = [System.IO.MemoryStream]::new()
$writer = [System.IO.BinaryWriter]::new($icoStream)
try {
    $writer.Write([uint16]0)
    $writer.Write([uint16]1)
    $writer.Write([uint16]$icoSizes.Length)
    $offset = 6 + 16 * $icoSizes.Length
    foreach ($size in $icoSizes) {
        $dimension = if ($size -eq 256) { 0 } else { $size }
        $writer.Write([byte]$dimension)
        $writer.Write([byte]$dimension)
        $writer.Write([byte]0)
        $writer.Write([byte]0)
        $writer.Write([uint16]1)
        $writer.Write([uint16]32)
        $writer.Write([uint32]($pngBySize[$size].Length))
        $writer.Write([uint32]$offset)
        $offset += $pngBySize[$size].Length
    }
    foreach ($size in $icoSizes) { $writer.Write([byte[]]($pngBySize[$size])) }
    $writer.Flush()
    [System.IO.File]::WriteAllBytes((Join-Path $output 'icon.ico'), $icoStream.ToArray())
} finally {
    $writer.Dispose()
    $icoStream.Dispose()
}

# ICNS: big-endian container/chunk lengths, modern PNG image payloads.
# ic11-ic14 distinguish Retina representations from equal-sized normal images.
$icnsEntries = @(
    @{ Type = 'icp4'; Size = 16 },
    @{ Type = 'icp5'; Size = 32 },
    @{ Type = 'icp6'; Size = 64 },
    @{ Type = 'ic07'; Size = 128 },
    @{ Type = 'ic08'; Size = 256 },
    @{ Type = 'ic09'; Size = 512 },
    @{ Type = 'ic10'; Size = 1024 },
    @{ Type = 'ic11'; Size = 32 },
    @{ Type = 'ic12'; Size = 64 },
    @{ Type = 'ic13'; Size = 256 },
    @{ Type = 'ic14'; Size = 512 }
)
$icnsLength = 8
foreach ($entry in $icnsEntries) { $icnsLength += 8 + $pngBySize[$entry.Size].Length }
$icnsStream = [System.IO.MemoryStream]::new()
try {
    $signature = [System.Text.Encoding]::ASCII.GetBytes('icns')
    $icnsStream.Write($signature, 0, $signature.Length)
    Write-BigEndian32 -Stream $icnsStream -Value $icnsLength
    foreach ($entry in $icnsEntries) {
        $type = [System.Text.Encoding]::ASCII.GetBytes($entry.Type)
        [byte[]]$png = $pngBySize[$entry.Size]
        $icnsStream.Write($type, 0, $type.Length)
        Write-BigEndian32 -Stream $icnsStream -Value (8 + $png.Length)
        $icnsStream.Write($png, 0, $png.Length)
    }
    [System.IO.File]::WriteAllBytes((Join-Path $output 'icon.icns'), $icnsStream.ToArray())
} finally {
    $icnsStream.Dispose()
}

Write-Output ('Exported Linux PNG, Windows ICO, macOS ICNS and iconset to ' + $output)
