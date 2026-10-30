import { X509Certificate } from "node:crypto";
import { readFile } from "node:fs/promises";
import { isIP } from "node:net";
import { loadWindowsKoffi } from "./windows-ffi";

function nativeApi() {
  const koffi = loadWindowsKoffi();
  const library = koffi.load("crypt32.dll");
  const Usage = koffi.struct("RelayTrustUsage", { count: "uint32", identifiers: "void *" });
  const Match = koffi.struct("RelayTrustUsageMatch", { type: "uint32", usage: Usage });
  const ChainPara = koffi.struct("RelayTrustChainPara", {
    size: "uint32", requestedUsage: Match, requestedPolicy: Match,
    timeout: "uint32", checkFreshness: "int32", freshness: "uint32", cacheResync: "void *", strongSign: "void *", strongFlags: "uint32",
  });
  const EngineConfig = koffi.struct("RelayTrustEngineConfig", {
    size: "uint32", restrictedRoot: "void *", restrictedTrust: "void *", restrictedOther: "void *",
    additionalCount: "uint32", additionalStores: "void *", flags: "uint32", timeout: "uint32",
    cachedCertificates: "uint32", cycleModulus: "uint32", exclusiveRoot: "void *", exclusivePeople: "void *", exclusiveFlags: "uint32",
  });
  const CertificateContext = koffi.struct("RelayTrustCertificateContext", {
    encoding: "uint32", encoded: "void *", length: "uint32", info: "void *", store: "void *",
  });
  const SslPolicy = koffi.struct("RelayTrustSslPolicy", { size: "uint32", authType: "uint32", checks: "uint32", name: "str16" });
  const PolicyPara = koffi.struct("RelayTrustPolicyPara", { size: "uint32", flags: "uint32", extra: koffi.pointer(SslPolicy) });
  const PolicyStatus = koffi.struct("RelayTrustPolicyStatus", { size: "uint32", error: "uint32", chainIndex: "int32", elementIndex: "int32", extra: "void *" });
  // The pointer array contains a raw address. Retain both public buffers for
  // asynchronous chain calls rather than relying on a temporary JS local.
  const serverAuthOid = Buffer.from("1.3.6.1.5.5.7.3.1\0");
  const serverAuthPointers = Buffer.alloc(koffi.sizeof("void *"));
  koffi.encode(serverAuthPointers, koffi.array("void *", 1), [serverAuthOid]);
  const bind = (name: string, result: string, args: any[]) => library.func("__stdcall", name, result, args);
  return {
    koffi, ChainPara, EngineConfig, CertificateContext, SslPolicy, PolicyPara, PolicyStatus, serverAuthOid, serverAuthPointers,
    openStore: bind("CertOpenStore", "void *", ["uintptr_t", "uint32", "uintptr_t", "uint32", "void *"]),
    closeStore: bind("CertCloseStore", "int32", ["void *", "uint32"]),
    addCertificate: bind("CertAddEncodedCertificateToStore", "int32", ["void *", "uint32", "void *", "uint32", "uint32", "void *"]),
    createEngine: bind("CertCreateCertificateChainEngine", "int32", [koffi.pointer(EngineConfig), "_Out_ void **"]),
    freeEngine: bind("CertFreeCertificateChainEngine", "void", ["void *"]),
    duplicateCertificate: bind("CertDuplicateCertificateContext", "void *", ["void *"]),
    freeCertificate: bind("CertFreeCertificateContext", "int32", ["void *"]),
    chain: bind("CertGetCertificateChain", "int32", ["void *", "void *", "void *", "void *", koffi.pointer(ChainPara), "uint32", "void *", "_Out_ void **"]),
    freeChain: bind("CertFreeCertificateChain", "void", ["void *"]),
    policy: bind("CertVerifyCertificateChainPolicy", "int32", ["uintptr_t", "void *", koffi.pointer(PolicyPara), koffi.inout(koffi.pointer(PolicyStatus))]),
  };
}

let shared: ReturnType<typeof nativeApi> | undefined;

/** Windows trust and SSL policy, with optional application-private PEM roots. */
export async function createWindowsTrust(caFile: string) {
  const api = shared ??= nativeApi();
  const { koffi } = api;
  let store: any = null;
  let engine: any = null;
  let closing = false;
  let released = false;
  const pending = new Set<Promise<void>>();
  const release = () => {
    if (released) return;
    released = true;
    if (engine) api.freeEngine(engine);
    if (store) api.closeStore(store, 0);
    engine = null; store = null;
  };
  try {
    if (caFile) {
      const pem = await readFile(caFile, "utf8");
      const certificates = pem.match(/-----BEGIN CERTIFICATE-----[\s\S]+?-----END CERTIFICATE-----/g) ?? [];
      if (!certificates.length || certificates.length > 1024) throw new Error("The trusted CA bundle must contain PEM certificates.");
      store = api.openStore(2, 0, 0, 0x2000, null); // CERT_STORE_PROV_MEMORY, create private store.
      if (!store) throw new Error("Cannot create the private Windows CA store.");
      for (const pemCertificate of certificates) {
        const der = new X509Certificate(pemCertificate).raw;
        if (!api.addCertificate(store, 0x10001, der, der.length, 4, null)) throw new Error("Cannot load a certificate into the private Windows CA store.");
      }
      const result = [null];
      const configuration = {
        size: koffi.sizeof(api.EngineConfig), restrictedRoot: null, restrictedTrust: null, restrictedOther: null,
        additionalCount: 0, additionalStores: null, flags: 0, timeout: 10000, cachedCertificates: 0, cycleModulus: 0,
        exclusiveRoot: store, exclusivePeople: null, exclusiveFlags: 0,
      };
      if (!api.createEngine(configuration, result) || !result[0]) throw new Error("Cannot configure Windows certificate-chain validation.");
      engine = result[0];
    }
  } catch (error) { release(); throw error; }

  async function verify(remoteContext: any, hostname: string): Promise<void> {
    const certificate = api.duplicateCertificate(remoteContext);
    if (!certificate) throw new Error("The server did not provide a usable TLS certificate.");
    let chain: any = null;
    try {
      const context = koffi.decode(certificate, api.CertificateContext) as { encoded: any; length: number; store: any };
      const der = Buffer.from(koffi.decode(context.encoded, koffi.array("uint8", context.length)) as number[]);
      const parsed = new X509Certificate(der);
      const host = hostname.replace(/^\[|\]$/g, "");
      if (!(isIP(host) ? parsed.checkIP(host) : parsed.checkHost(host, { wildcards: true, partialWildcards: false }))) {
        throw new Error("TLS server hostname or IP verification failed.");
      }
      const emptyUsage = { type: 0, usage: { count: 0, identifiers: null } };
      const parameters = {
        size: koffi.sizeof(api.ChainPara), requestedUsage: { type: 0, usage: { count: 1, identifiers: api.serverAuthPointers } },
        requestedPolicy: emptyUsage, timeout: 10000, checkFreshness: 0, freshness: 0, cacheResync: null, strongSign: null, strongFlags: 0,
      };
      const output = [null];
      const result = await new Promise<number>((resolve, reject) => {
        api.chain.async(engine, certificate, null, context.store, parameters, 0, null, output,
          (error: Error | null, value: number) => error ? reject(error) : resolve(value));
      });
      chain = output[0];
      if (!result || !chain) throw new Error("Windows could not build the server certificate chain.");
      if (closing) throw new Error("Windows TLS verification was cancelled.");
      const status = { size: koffi.sizeof(api.PolicyStatus), error: 0, chainIndex: 0, elementIndex: 0, extra: null };
      const policy = {
        size: koffi.sizeof(api.PolicyPara), flags: 0,
        extra: { size: koffi.sizeof(api.SslPolicy), authType: 2, checks: 0, name: host },
      };
      if (!api.policy(4, chain, policy, status) || status.error !== 0) {
        throw new Error(`TLS server certificate verification failed (Windows policy 0x${status.error.toString(16)}).`);
      }
    } finally {
      if (chain) api.freeChain(chain);
      api.freeCertificate(certificate);
    }
  }

  return {
    async validate(remoteContext: any, hostname: string): Promise<void> {
      if (closing) throw new Error("Windows TLS trust context has closed.");
      const task = verify(remoteContext, hostname);
      pending.add(task);
      try { await task; } finally { pending.delete(task); }
    },
    async close(): Promise<void> {
      closing = true;
      await Promise.allSettled([...pending]);
      release();
    },
  };
}
