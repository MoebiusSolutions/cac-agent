import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { existsSync } from "node:fs";
import { dirname, isAbsolute, join } from "node:path";
import type { LaunchSettings } from "../shared/types";

export function defaultSettings(): LaunchSettings {
  let sslLibraryPath = "libssl.so.3";
  let cryptoLibraryPath = "libcrypto.so.3";
  if (process.platform === "darwin") {
    const prefix = ["/opt/homebrew/opt/openssl@3/lib", "/usr/local/opt/openssl@3/lib"]
      .find((path) => existsSync(join(path, "libssl.3.dylib")));
    sslLibraryPath = prefix ? join(prefix, "libssl.3.dylib") : "libssl.3.dylib";
    cryptoLibraryPath = prefix ? join(prefix, "libcrypto.3.dylib") : "libcrypto.3.dylib";
  } else if (process.platform === "win32") {
    const suffix = process.arch === "arm64" ? "arm64" : "x64";
    sslLibraryPath = `libssl-3-${suffix}.dll`;
    cryptoLibraryPath = `libcrypto-3-${suffix}.dll`;
  }
  return {
    sslLibraryPath,
    cryptoLibraryPath,
    configDirectory: join(homedir(), ".moesol", "cac-agent"),
    identityMode: process.platform === "win32" ? "ncrypt" : "pkcs11",
    windowsCertificateId: "",
    providerPath: "pkcs11",
    pkcs11ModulePath: "",
    certificate: "",
    privateKey: "",
    caFile: "",
    localCertificatePath: "",
    localKeyPath: "",
  };
}

export function validateSettings(input: LaunchSettings): LaunchSettings {
  if (!input || typeof input !== "object") throw new Error("Invalid runtime settings.");
  const output = {} as LaunchSettings;
  for (const key of ["sslLibraryPath", "cryptoLibraryPath", "configDirectory", "providerPath", "pkcs11ModulePath", "certificate", "privateKey", "caFile", "localCertificatePath", "localKeyPath"] as const) {
    if (typeof input[key] !== "string" || /[\0\r\n]/.test(input[key])) {
      throw new Error(`Invalid ${key}.`);
    }
    output[key] = input[key].trim();
  }
  for (const key of ["sslLibraryPath", "cryptoLibraryPath"] as const) {
    if (input.identityMode === "ncrypt" && !output[key]) continue;
    if (!output[key] || (!isAbsolute(output[key]) && !/^[a-zA-Z0-9_.+-]+$/.test(output[key]))) {
      throw new Error(`${key} must be an absolute path or a library filename.`);
    }
  }
  if (!isAbsolute(output.configDirectory)) throw new Error("Configuration directory must be an absolute path.");
  if (!["ncrypt", "pkcs11", "pem", "none"].includes(input.identityMode)) throw new Error("Choose a valid client identity mode.");
  output.identityMode = input.identityMode;
  if (typeof input.windowsCertificateId !== "string") throw new Error("Invalid Windows certificate selection.");
  output.windowsCertificateId = input.windowsCertificateId.replace(/\s|:/g, "").toUpperCase();
  if (output.windowsCertificateId && !/^[0-9A-F]{40}$/.test(output.windowsCertificateId)) throw new Error("Choose a valid Windows certificate thumbprint.");
  for (const key of ["pkcs11ModulePath", "caFile", "localCertificatePath", "localKeyPath"] as const) {
    if (output[key] && !isAbsolute(output[key])) throw new Error(`${key} must be an absolute path.`);
  }
  if (output.providerPath && !isAbsolute(output.providerPath) && !/^[a-zA-Z0-9_.+-]+$/.test(output.providerPath)) {
    throw new Error("Provider must be an absolute path or a provider name.");
  }
  for (const key of ["certificate", "privateKey"] as const) {
    if (output[key].startsWith("pkcs11:")) {
      if (output[key].includes("?")) throw new Error("PKCS#11 URI query parameters are not accepted; enter the PIN in the session-only field.");
      if (/pin-(?:value|source)\s*=/i.test(output[key])) throw new Error("Keep PINs out of saved PKCS#11 URIs.");
    } else if (output[key] && !isAbsolute(output[key])) throw new Error(`${key} must be an absolute PEM path or a PKCS#11 URI.`);
  }
  if (output.identityMode === "pem" && (output.certificate.startsWith("pkcs11:") || output.privateKey.startsWith("pkcs11:"))) {
    throw new Error("Choose PKCS#11 mode for token URIs.");
  }
  return output;
}

export class SettingsStore {
  constructor(
    private readonly defaults: LaunchSettings,
    private readonly file = join(homedir(), ".moesol", "cac-ssl-relay-desktop", "settings.json"),
  ) {}

  async load(): Promise<LaunchSettings> {
    try {
      return validateSettings({ ...this.defaults, ...JSON.parse(await readFile(this.file, "utf8")) });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return { ...this.defaults };
      throw new Error(`Cannot load desktop settings: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  async save(input: LaunchSettings): Promise<LaunchSettings> {
    const settings = validateSettings(input);
    await mkdir(dirname(this.file), { recursive: true, mode: 0o700 });
    const temporary = `${this.file}.${crypto.randomUUID()}.tmp`;
    try {
      await writeFile(temporary, `${JSON.stringify(settings, null, 2)}\n`, { mode: 0o600, flag: "wx" });
      await rename(temporary, this.file);
    } finally {
      await rm(temporary, { force: true });
    }
    return settings;
  }
}
