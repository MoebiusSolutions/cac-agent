# CAC SSL Relay application icon

The shared design combines a mint relay-arrow shield, a gold smart-card contact chip, and an ink-navy tile. It matches the application's existing navy and mint interface. The area outside the tile has transparent alpha.

Artwork was generated with the built-in `image_gen` tool on 2026-10-30. `icon-master.png` is the original 1254 × 1254 RGBA image. Platform files are mechanical resizes and format conversions of this master.

| Platform | Asset | Contents |
| --- | --- | --- |
| Windows | `icon.ico` | Nine 32-bit PNG frames: 16, 20, 24, 32, 40, 48, 64, 128, 256 px |
| Linux | `icon.png` | 1024 × 1024 RGBA PNG |
| macOS | `icon.icns` | PNG-backed ICNS, including normal and Retina representations through 1024 px |
| macOS build | `icon.iconset/` | The ten standard PNG filenames consumed by `iconutil` |

`electrobun.config.ts` references the Windows ICO, Linux PNG, and macOS iconset. Electrobun generates the application bundle's ICNS on macOS.

To regenerate the platform exports on Windows, run from the application directory:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/export-icons.ps1
```

The script uses Windows' built-in System.Drawing APIs and preserves the original master. No API key or image-generation service is required to regenerate exports.

## Generation prompt

```text
Use case: logo-brand.
Asset type: production desktop application icon for CAC SSL Relay, a secure smart-card TLS relay, shared across Windows, Linux and macOS.
Primary request: design one exceptionally polished, distinctive, modern security application icon. One bold sculptural mint-teal shield made from two interlocking flowing relay-arrow ribbons, with a small warm metallic gold smart-card contact chip at its heart. Integrate the opposing arrow tips into the shield silhouette, so the emblem suggests authenticated traffic passing securely through a gateway. Keep the chip simple and clearly recognizable, with broad separated contacts.
Style/medium: premium macOS-quality dimensional icon design, precise beveled edges, subtle depth and restrained satin-metal reflections, mostly frontal and geometric, crisp silhouette. Sophisticated and calm, not a gaming badge.
Scene/backdrop: the emblem sits on a dark ink-navy rounded-square app tile that harmonizes with an existing dark navy and mint (#63dfc1) UI. Gentle material gradients inside the tile. Outside the tile the image is genuinely transparent.
Composition: exactly one centered square icon, full artwork fits inside a centered approximately 82% square of the canvas with generous transparent margin. Shield and chip large and simple enough to read at 32x32. Symmetric visual balance, clear high contrast, no thin details.
Constraints: transparent alpha background outside the tile; no text, letters, numbers, watermarks, platform logos, mockups, extra icons, sparkles, padlock, cables, or floating objects. Produce only the finished icon, 1024x1024 or higher square.
```
