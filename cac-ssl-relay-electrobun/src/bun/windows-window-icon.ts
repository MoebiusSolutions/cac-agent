import { loadWindowsKoffi } from "./windows-ffi";

type Handle = number | bigint;
const WM_GETICON = 0x007f;
const WM_SETICON = 0x0080;

function bindWindowIcons() {
  const koffi = loadWindowsKoffi();
  const user32 = koffi.load("user32.dll");
  const kernel32 = koffi.load("kernel32.dll");
  return {
    user32, kernel32,
    isWindow: user32.func("__stdcall", "IsWindow", "int32", ["uintptr_t"]),
    owner: user32.func("__stdcall", "GetWindowThreadProcessId", "uint32", ["uintptr_t", "_Out_ uint32 *"]),
    dpi: user32.func("__stdcall", "GetDpiForWindow", "uint32", ["uintptr_t"]),
    metric: user32.func("__stdcall", "GetSystemMetricsForDpi", "int32", ["int32", "uint32"]),
    load: user32.func("__stdcall", "LoadImageW", "uintptr_t", ["uintptr_t", "str16", "uint32", "int32", "int32", "uint32"]),
    send: user32.func("__stdcall", "SendMessageW", "intptr_t", ["uintptr_t", "uint32", "uintptr_t", "intptr_t"]),
    destroy: user32.func("__stdcall", "DestroyIcon", "int32", ["uintptr_t"]),
    lastError: kernel32.func("__stdcall", "GetLastError", "uint32", []),
  };
}

let bindings: ReturnType<typeof bindWindowIcons> | undefined;

/** Electrobun 2.0.5 leaves its Windows window-class icon unset. */
export function installWindowsWindowIcon(handle: Handle | null, iconPath: string): () => void {
  if (process.platform !== "win32") return () => {};
  const a = bindings ??= bindWindowIcons();
  const ownsWindow = (): boolean => {
    if (!handle || !a.isWindow(handle)) return false;
    const owner = [0];
    return !!a.owner(handle, owner) && owner[0] === process.pid;
  };
  if (!ownsWindow()) throw new Error("Cannot assign an icon to a window outside this application.");
  const dpi = a.dpi(handle) || 96;
  const entries = [
    { type: 0, width: a.metric(49, dpi), height: a.metric(50, dpi), icon: 0 as Handle, previous: 0 as Handle },
    { type: 1, width: a.metric(11, dpi), height: a.metric(12, dpi), icon: 0 as Handle, previous: 0 as Handle },
  ];
  let disposed = false;
  const dispose = (): void => {
    if (disposed) return;
    disposed = true;
    for (const entry of entries) {
      if (!entry.icon) continue;
      // Never destroy an icon still assigned to a live window. Restore only
      // our own assignments, and never destroy the framework's prior handles.
      if (ownsWindow() && BigInt(a.send(handle, WM_GETICON, entry.type, 0)) === BigInt(entry.icon)) {
        a.send(handle, WM_SETICON, entry.type, entry.previous);
      }
      a.destroy(entry.icon);
    }
  };
  try {
    // Load owned, DPI-sized handles before changing either window icon.
    for (const entry of entries) {
      entry.icon = a.load(0, iconPath, 1, entry.width, entry.height, 0x10);
      if (!entry.icon) throw new Error(`Loading the Windows application icon failed (Windows error ${a.lastError()}).`);
    }
    for (const entry of entries) {
      entry.previous = a.send(handle, WM_SETICON, entry.type, entry.icon);
      if (BigInt(a.send(handle, WM_GETICON, entry.type, 0)) !== BigInt(entry.icon)) {
        throw new Error("Windows did not apply the application window icon.");
      }
    }
    return dispose;
  } catch (error) {
    dispose();
    throw error;
  }
}
