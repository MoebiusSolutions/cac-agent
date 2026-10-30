import { createRequire } from "node:module";
import type * as Koffi from "koffi";

let instance: typeof Koffi | undefined;

/** Koffi is copied beside the packaged app; keep its native addon outside the bundle. */
export function loadWindowsKoffi(): typeof Koffi {
  if (process.platform !== "win32") throw new Error("Windows certificate-store authentication is available only on Windows.");
  instance ??= createRequire(import.meta.url)("koffi") as typeof Koffi;
  return instance;
}
