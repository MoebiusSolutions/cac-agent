import { afterAll, afterEach, beforeAll, describe, expect, test } from "bun:test";
import { X509Certificate } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { listWindowsCertificates, lookupWindowsCertificate } from "../src/bun/windows-certificates";
import { loadWindowsKoffi } from "../src/bun/windows-ffi";
import { createWindowsTrust } from "../src/bun/windows-trust";

const directory = process.env.CAC_TEST_WINDOWS_TLS_DIRECTORY;
const certificateId = process.env.CAC_TEST_WINDOWS_CERTIFICATE_ID;

test.skipIf(process.platform !== "win32" || !certificateId)("Windows Personal store discovers and retains the exact temporary CNG client certificate", async () => {
  // The harness owns this temporary software key/certificate and removes both.
  // Listing/lookup never acquire its private key, or inspect unrelated key data.
  const id = certificateId!.toUpperCase();
  const certificates = await listWindowsCertificates();
  expect(certificates.some(certificate => certificate.id === id)).toBe(true);
  const selected = lookupWindowsCertificate(id.toLowerCase());
  try {
    expect(selected.certificate.id).toBe(id);
    expect(Boolean(selected.context)).toBe(true);
    expect(Boolean(selected.store)).toBe(true);
  } finally {
    selected.close();
    selected.close();
  }
  // Reopening after both close calls checks that the retained native reference
  // was released without consuming the certificate's persisted store entry.
  const reopened = lookupWindowsCertificate(id);
  try { expect(reopened.certificate.id).toBe(id); }
  finally { reopened.close(); }
});

describe.skipIf(process.platform !== "win32" || !directory)("Windows certificate-chain and SSL policy", () => {
  let native: ReturnType<typeof fixtureApi>;
  let temporaryDirectory: string;
  const trusts = new Set<Awaited<ReturnType<typeof createWindowsTrust>>>();
  const contexts = new Set<unknown>();
  const stores = new Set<unknown>();

  function fixtureApi() {
    const koffi = loadWindowsKoffi();
    const library = koffi.load("crypt32.dll");
    return {
      library,
      create: library.func("__stdcall", "CertCreateCertificateContext", "void *", ["uint32", "void *", "uint32"]),
      free: library.func("__stdcall", "CertFreeCertificateContext", "int32", ["void *"]),
      openStore: library.func("__stdcall", "CertOpenStore", "void *", ["uintptr_t", "uint32", "void *", "uint32", "void *"]),
      closeStore: library.func("__stdcall", "CertCloseStore", "int32", ["void *", "uint32"]),
      add: library.func("__stdcall", "CertAddEncodedCertificateToStore", "int32", ["void *", "uint32", "void *", "uint32", "uint32", "_Out_ void **"]),
    };
  }

  beforeAll(async () => {
    native = fixtureApi();
    temporaryDirectory = await mkdtemp(join(tmpdir(), "cac-windows-trust-test-"));
  });

  afterEach(async () => {
    await Promise.all([...trusts].map(trust => trust.close()));
    trusts.clear();
    for (const context of contexts) native.free(context);
    contexts.clear();
    for (const store of stores) native.closeStore(store, 0);
    stores.clear();
  });
  afterAll(async () => { if (temporaryDirectory) await rm(temporaryDirectory, { recursive: true, force: true }); });

  async function trust(caFile = join(directory!, "ca.crt")) {
    const instance = await createWindowsTrust(caFile);
    trusts.add(instance);
    return instance;
  }

  async function peer(name = "server", attached = false): Promise<unknown> {
    const der = new X509Certificate(await readFile(join(directory!, `${name}.crt`))).raw;
    let context: unknown;
    if (attached) {
      const store = native.openStore(2, 0, null, 0x2000, null);
      if (!store) throw new Error("Cannot create the isolated peer certificate store.");
      stores.add(store);
      const root = new X509Certificate(await readFile(join(directory!, "ca.crt"))).raw;
      const rootContext = [null];
      if (!native.add(store, 0x10001, root, root.length, 4, rootContext)) throw new Error("Cannot add the fixture root to the isolated peer store.");
      if (rootContext[0]) native.free(rootContext[0]);
      const result = [null];
      if (!native.add(store, 0x10001, der, der.length, 4, result)) throw new Error("Cannot add the fixture peer to the isolated store.");
      context = result[0];
    } else {
      context = native.create(0x10001, der, der.length);
    }
    if (!context) throw new Error("crypt32 rejected a public certificate fixture.");
    contexts.add(context);
    return context;
  }

  test("validates a detached server certificate using only the application-private CA bundle", async () => {
    const verifier = await trust();
    await expect(verifier.validate(await peer(), "localhost")).resolves.toBeUndefined();
  });

  test("accepts a peer context attached to an isolated memory certificate store", async () => {
    const verifier = await trust();
    await expect(verifier.validate(await peer("server", true), "localhost")).resolves.toBeUndefined();
  });

  test("rejects a trusted chain whose server name differs from the requested host", async () => {
    const verifier = await trust();
    await expect(verifier.validate(await peer("wrong-host"), "localhost")).rejects.toThrow("hostname or IP verification failed");
    await expect(verifier.validate(await peer(), "unrelated.invalid")).rejects.toThrow("hostname or IP verification failed");
  });

  test("private roots never become global Windows trust anchors", async () => {
    const context = await peer();
    const systemBefore = await trust("");
    await expect(systemBefore.validate(context, "localhost")).rejects.toThrow("certificate verification failed");
    const privateVerifier = await trust();
    await privateVerifier.validate(context, "localhost");
    const systemAfter = await trust("");
    await expect(systemAfter.validate(context, "localhost")).rejects.toThrow("certificate verification failed");
  });

  test("closing waits for an in-progress chain operation and prevents further verification", async () => {
    const verifier = await trust();
    const context = await peer();
    const validating = verifier.validate(context, "localhost");
    const closing = [verifier.close(), verifier.close()];
    await expect(validating).rejects.toThrow("cancelled");
    await Promise.all(closing);
    await expect(verifier.validate(context, "localhost")).rejects.toThrow("has closed");
  });

  test("rejects an invalid application CA bundle without changing Windows stores", async () => {
    const file = join(temporaryDirectory, "invalid-ca.pem");
    await writeFile(file, "This is not a certificate.\n");
    await expect(createWindowsTrust(file)).rejects.toThrow("must contain PEM certificates");
  });
});
