import { afterAll, afterEach, beforeAll, describe, expect, test } from "bun:test";
import { createHash, X509Certificate } from "node:crypto";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describeWindowsCertificate, listWindowsCertificates, lookupWindowsCertificate } from "../src/bun/windows-certificates";
import { loadWindowsKoffi } from "../src/bun/windows-ffi";

test.skipIf(process.platform === "win32")("Windows certificate mode reports unsupported platforms without loading a native addon", async () => {
  await expect(listWindowsCertificates()).rejects.toThrow("only on Windows");
  expect(() => lookupWindowsCertificate("A".repeat(40))).toThrow("only on Windows");
});

test("certificate lookup rejects malformed thumbprints before accessing a native store", () => {
  for (const id of ["", "../client.pem", "A".repeat(39), "G".repeat(40), `A${"B".repeat(39)}\0`]) {
    expect(() => lookupWindowsCertificate(id)).toThrow("Select a Windows client certificate");
  }
});

// A detached crypt32 context has exactly the same properties/ABI as a store
// context. These tests attach metadata for a deliberately nonexistent software
// key: enumeration must neither open a key nor contact any hardware token.
describe.skipIf(process.platform !== "win32" || !Bun.which("openssl"))("Windows native certificate metadata", () => {
  let directory: string;
  let native: ReturnType<typeof bindFixture>;
  const contexts = new Set<unknown>();
  const encoded = new Map<string, Buffer>();

  function bindFixture() {
    const koffi = loadWindowsKoffi();
    const library = koffi.load("crypt32.dll");
    const ProviderInfo = koffi.struct("CAC_CERT_TEST_PROVIDER_INFO", {
      container: "str16", provider: "str16", type: "uint32", flags: "uint32",
      parameterCount: "uint32", parameters: "void *", keySpec: "uint32",
    });
    const Usage = koffi.struct("CAC_CERT_TEST_EKU", { count: "uint32", identifiers: koffi.pointer("str") });
    return {
      library,
      create: library.func("__stdcall", "CertCreateCertificateContext", "void *", ["uint32", "void *", "uint32"]),
      free: library.func("__stdcall", "CertFreeCertificateContext", "int32", ["void *"]),
      setProvider: library.func("__stdcall", "CertSetCertificateContextProperty", "int32", ["void *", "uint32", "uint32", koffi.pointer(ProviderInfo)]),
      setUsage: library.func("__stdcall", "CertSetEnhancedKeyUsage", "int32", ["void *", koffi.pointer(Usage)]),
    };
  }

  function openssl(args: string[]) {
    const result = Bun.spawnSync(["openssl", ...args], { cwd: directory, stdout: "pipe", stderr: "pipe" });
    if (result.exitCode !== 0) throw new Error(`Creating Windows certificate test fixture failed: ${result.stderr.toString()}`);
  }

  beforeAll(async () => {
    directory = await mkdtemp(join(tmpdir(), "cac-windows-certificate-test-"));
    native = bindFixture();
    openssl(["genpkey", "-algorithm", "RSA", "-pkeyopt", "rsa_keygen_bits:2048", "-out", "rsa.key"]);
    openssl(["genpkey", "-algorithm", "EC", "-pkeyopt", "ec_paramgen_curve:P-256", "-out", "ec.key"]);
    for (const [name, key, usage, eku] of [
      ["rsa", "rsa", "digitalSignature", "clientAuth"],
      ["ec", "ec", "digitalSignature", "clientAuth"],
      ["unrestricted", "rsa", "", ""],
      ["encryption", "rsa", "keyEncipherment", "clientAuth"],
      ["server", "rsa", "digitalSignature", "serverAuth"],
      ["any-eku", "rsa", "digitalSignature", "2.5.29.37.0"],
    ]) {
      openssl(["req", "-x509", "-key", `${key}.key`, "-out", `${name}.der`, "-outform", "DER", "-days", "2", "-subj", `/CN=Relay fixture ${name}`,
        "-addext", "basicConstraints=critical,CA:FALSE",
        ...(usage ? ["-addext", `keyUsage=critical,${usage}`] : []),
        ...(eku ? ["-addext", `extendedKeyUsage=${eku}`] : []),
      ]);
      encoded.set(name!, await readFile(join(directory, `${name}.der`)));
    }
  });

  afterEach(() => { for (const context of contexts) native.free(context); contexts.clear(); });
  afterAll(async () => {
    // The fixture follows the same process-lifetime OS DLL ownership as the app.
    if (directory) await rm(directory, { recursive: true, force: true });
  });

  function fixture(name = "rsa", association: "cng" | "legacy" | "missing" | "uninstalled" = "cng", keySpec = 0): unknown {
    const der = encoded.get(name)!;
    const context = native.create(1, der, der.length);
    if (!context) throw new Error("crypt32 rejected a certificate test fixture.");
    contexts.add(context);
    if (association !== "missing") {
      const success = native.setProvider(context, 2, 0, {
        container: "CAC relay metadata fixture: this key intentionally does not exist",
        provider: association === "uninstalled" ? "CAC relay nonexistent KSP" : "Microsoft Software Key Storage Provider",
        type: association === "legacy" ? 1 : 0, flags: 0, parameterCount: 0, parameters: null,
        keySpec: association === "legacy" ? 2 : keySpec,
      });
      if (!success) throw new Error("crypt32 rejected fixture key association metadata.");
    }
    return context;
  }

  test("includes RSA signing-only and ECDSA certificates with exact SHA1 IDs and public metadata", () => {
    for (const name of ["rsa", "ec"]) {
      const cert = describeWindowsCertificate(fixture(name));
      const expected = new X509Certificate(encoded.get(name)!);
      expect(cert).toEqual({
        id: createHash("sha1").update(encoded.get(name)!).digest("hex").toUpperCase(),
        subject: expected.subject, issuer: expected.issuer,
        validFrom: new Date(expected.validFrom).toISOString(), validTo: new Date(expected.validTo).toISOString(),
        provider: "Microsoft Software Key Storage Provider",
      });
    }
  });

  test("permits absent usage restrictions and rejects encryption-only or server-only certificates", () => {
    expect(describeWindowsCertificate(fixture("unrestricted"))).not.toBeNull();
    expect(describeWindowsCertificate(fixture("any-eku"))).not.toBeNull();
    expect(describeWindowsCertificate(fixture("encryption"))).toBeNull();
    expect(describeWindowsCertificate(fixture("server"))).toBeNull();
  });

  test("rejects missing/legacy private-key associations and unregistered providers without opening a key", () => {
    for (const association of ["missing", "legacy", "uninstalled"] as const) {
      expect(describeWindowsCertificate(fixture("rsa", association))).toBeNull();
    }
  });

  test("accepts Windows persisted CNG associations with zero, legacy, or NCrypt key specifications", () => {
    for (const keySpec of [0, 1, 2, 0xffffffff]) {
      expect(describeWindowsCertificate(fixture("rsa", "cng", keySpec))).not.toBeNull();
    }
  });

  test("honors Windows EKU property restrictions, including an empty intersection", () => {
    const context = fixture();
    expect(native.setUsage(context, { count: 1, identifiers: ["1.3.6.1.5.5.7.3.2"] })).toBe(1);
    expect(describeWindowsCertificate(context)).not.toBeNull();
    expect(native.setUsage(context, { count: 1, identifiers: ["1.3.6.1.5.5.7.3.1"] })).toBe(1);
    expect(describeWindowsCertificate(context)).toBeNull();
    expect(native.setUsage(context, { count: 0, identifiers: null })).toBe(1);
    expect(describeWindowsCertificate(context)).toBeNull();
  });

  test("omits certificates that are not yet valid or expired", () => {
    const context = fixture();
    const cert = new X509Certificate(encoded.get("rsa")!);
    expect(describeWindowsCertificate(context, Date.parse(cert.validFrom) - 1000)).toBeNull();
    expect(describeWindowsCertificate(context, Date.parse(cert.validTo) + 1000)).toBeNull();
  });
});
