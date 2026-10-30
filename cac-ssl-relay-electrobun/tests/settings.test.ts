import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { defaultSettings, SettingsStore, validateSettings } from "../src/bun/settings";
import type { LaunchSettings } from "../src/shared/types";

let directory: string;
beforeEach(async () => { directory = await mkdtemp(join(tmpdir(), "cac-native-settings-")); });
afterEach(async () => { await rm(directory, { recursive: true, force: true }); });

test("persists native settings only, with owner-only permissions and no session secrets or legacy fields", async () => {
  const defaults = { ...defaultSettings(), configDirectory: directory };
  const file = join(directory, "desktop", "settings.json");
  const store = new SettingsStore(defaults, file);
  expect(await store.load()).toEqual(defaults);
  const input = { ...defaults, pin: "secret-pin", localKeyPassphrase: "secret-pass", javaPath: "java", jarPath: "old.jar" } as LaunchSettings;
  expect(await store.save(input)).toEqual(defaults);
  const bytes = await readFile(file, "utf8");
  for (const excluded of ["secret-pin", "secret-pass", "javaPath", "jarPath"]) expect(bytes).not.toContain(excluded);
  if (process.platform !== "win32") expect((await stat(file)).mode & 0o777).toBe(0o600);
  expect(await store.load()).toEqual(defaults);
});

test("preserves configuration directory while ignoring old desktop settings", async () => {
  const file = join(directory, "old.json");
  await writeFile(file, JSON.stringify({ javaPath: "java", jarPath: "/old.jar", configDirectory: directory }));
  expect(await new SettingsStore(defaultSettings(), file).load()).toEqual({ ...defaultSettings(), configDirectory: directory });
});

test("Windows store mode saves a thumbprint without OpenSSL or PKCS#11 configuration", async () => {
  const settings: LaunchSettings = {
    ...defaultSettings(), configDirectory: directory, identityMode: "ncrypt",
    windowsCertificateId: "ab:".repeat(19) + "ab", sslLibraryPath: "", cryptoLibraryPath: "",
    providerPath: "", pkcs11ModulePath: "", certificate: "", privateKey: "",
  };
  const store = new SettingsStore(defaultSettings(), join(directory, "windows.json"));
  const saved = await store.save(settings);
  expect(saved.windowsCertificateId).toBe("AB".repeat(20));
  expect(saved.sslLibraryPath).toBe("");
  expect(await store.load()).toEqual(saved);
  expect(() => validateSettings({ ...settings, windowsCertificateId: "not-a-thumbprint" })).toThrow("thumbprint");
});

test("rejects saved PINs, invalid modes, invalid paths and malformed settings documents", async () => {
  const settings = { ...defaultSettings(), configDirectory: directory };
  for (const privateKey of ["pkcs11:token=card?pin-value=1234", "pkcs11:token=card;pin-source=file:secret"]) {
    expect(() => validateSettings({ ...settings, privateKey })).toThrow("PIN");
  }
  expect(() => validateSettings({ ...settings, sslLibraryPath: "relative/libssl.so.3" })).toThrow("absolute path");
  expect(() => validateSettings({ ...settings, configDirectory: "relative" })).toThrow("absolute path");
  expect(() => validateSettings({ ...settings, identityMode: "invalid" } as unknown as LaunchSettings)).toThrow("identity mode");
  expect(() => validateSettings({ ...settings, identityMode: "pem", privateKey: "pkcs11:type=private" })).toThrow("PKCS#11 mode");
  const file = join(directory, "bad.json");
  await writeFile(file, "{broken");
  await expect(new SettingsStore(settings, file).load()).rejects.toThrow("Cannot load desktop settings");
  expect(await readFile(file, "utf8")).toBe("{broken");
});
