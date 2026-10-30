import { createHash, X509Certificate } from "node:crypto";
import type { WindowsCertificate } from "../shared/types";
import { loadWindowsKoffi } from "./windows-ffi";

export type { WindowsCertificate } from "../shared/types";

const CRYPT_E_NOT_FOUND = 0x80092004;
const CERT_KEY_PROV_INFO_PROP_ID = 2;
const CERT_NCRYPT_KEY_SPEC = 0xffffffff;
const CLIENT_AUTH = "1.3.6.1.5.5.7.3.2";
const ANY_USAGE = "2.5.29.37.0";
const MAX_NATIVE_DATA = 4 * 1024 * 1024;

function bindCertificates() {
  const koffi = loadWindowsKoffi();
  const CertContext = koffi.struct("CAC_DISCOVERY_CERT_CONTEXT", {
    encoding: "uint32", encoded: "void *", length: "uint32", info: "void *", store: "void *",
  });
  const ProviderInfo = koffi.struct("CAC_DISCOVERY_CRYPT_KEY_PROV_INFO", {
    container: "str16", provider: "str16", type: "uint32", flags: "uint32",
    parameterCount: "uint32", parameters: "void *", keySpec: "uint32",
  });
  const EnhancedUsage = koffi.struct("CAC_DISCOVERY_CERT_ENHKEY_USAGE", {
    count: "uint32", identifiers: "void *",
  });
  const ProviderName = koffi.struct("CAC_DISCOVERY_NCRYPT_PROVIDER_NAME", { name: "str16", comment: "str16" });
  const HashBlob = koffi.struct("CAC_DISCOVERY_CRYPT_HASH_BLOB", { length: "uint32", data: "void *" });
  // These loader references live for the process, including while Schannel owns a
  // retained certificate context or a cached key belonging to that context.
  const crypt32 = koffi.load("crypt32.dll");
  const kernel32 = koffi.load("kernel32.dll");
  const ncrypt = koffi.load("ncrypt.dll");
  return {
    koffi, crypt32, kernel32, ncrypt, CertContext, ProviderInfo, EnhancedUsage, ProviderName,
    openStore: crypt32.func("__stdcall", "CertOpenStore", "void *", ["uintptr_t", "uint32", "void *", "uint32", "str16"]),
    closeStore: crypt32.func("__stdcall", "CertCloseStore", "int32", ["void *", "uint32"]),
    enumerate: crypt32.func("__stdcall", "CertEnumCertificatesInStore", "void *", ["void *", "void *"]),
    find: crypt32.func("__stdcall", "CertFindCertificateInStore", "void *", ["void *", "uint32", "uint32", "uint32", koffi.pointer(HashBlob), "void *"]),
    freeContext: crypt32.func("__stdcall", "CertFreeCertificateContext", "int32", ["void *"]),
    getProperty: crypt32.func("__stdcall", "CertGetCertificateContextProperty", "int32", ["void *", "uint32", "void *", "_Inout_ uint32 *"]),
    getUsage: crypt32.func("__stdcall", "CertGetEnhancedKeyUsage", "int32", ["void *", "uint32", "void *", "_Inout_ uint32 *"]),
    getKeyUsage: crypt32.func("__stdcall", "CertGetIntendedKeyUsage", "int32", ["uint32", "void *", "_Out_ void *", "uint32"]),
    lastError: kernel32.func("__stdcall", "GetLastError", "uint32", []),
    clearError: kernel32.func("__stdcall", "SetLastError", "void", ["uint32"]),
    enumProviders: ncrypt.func("__stdcall", "NCryptEnumStorageProviders", "int32", ["_Out_ uint32 *", "_Out_ void **", "uint32"]),
    freeBuffer: ncrypt.func("__stdcall", "NCryptFreeBuffer", "int32", ["void *"]),
  };
}

let bindings: ReturnType<typeof bindCertificates> | undefined;
function api() { return bindings ??= bindCertificates(); }

function failure(operation: string, code: number): Error {
  return new Error(`${operation} failed (Windows error 0x${(code >>> 0).toString(16).padStart(8, "0")}).`);
}

function openPersonalStore(): unknown {
  const a = api();
  // CERT_STORE_PROV_SYSTEM_W, CURRENT_USER, OPEN_EXISTING, READONLY.
  const store = a.openStore(10, 0, null, 0x00010000 | 0x00004000 | 0x00008000, "MY");
  if (!store) throw failure("Opening the Windows Personal certificate store", a.lastError());
  return store;
}

function installedProviders(): Set<string> {
  const a = api();
  const count = [0];
  const pointer = [null];
  // Enumerating provider registration cannot open a token key or display PIN UI.
  const status = a.enumProviders(count, pointer, 0x40);
  if (status !== 0) throw failure("Listing Windows key storage providers", status);
  try {
    if (count[0]! > 4096 || (count[0] && !pointer[0])) throw new Error("Windows returned an invalid provider list.");
    if (!count[0]) return new Set();
    const providers = a.koffi.decode(pointer[0], a.ProviderName, count[0]!) as { name: string }[];
    return new Set(providers.map(provider => provider.name.toLowerCase()));
  } finally { if (pointer[0]) a.freeBuffer(pointer[0]); }
}

function providerFor(context: unknown, providers: Set<string>): string | null {
  const a = api();
  const size = [0];
  if (!a.getProperty(context, CERT_KEY_PROV_INFO_PROP_ID, null, size)) return null;
  if (size[0]! < a.koffi.sizeof(a.ProviderInfo) || size[0]! > MAX_NATIVE_DATA) return null;
  const data = Buffer.alloc(size[0]!);
  if (!a.getProperty(context, CERT_KEY_PROV_INFO_PROP_ID, data, size)) return null;
  const info = a.koffi.decode(data, a.ProviderInfo) as { container: string | null; provider: string | null; type: number; keySpec: number };
  // The persisted association is sufficient for discovery. Opening the private
  // key here would contact the card and might prompt before the user connects.
  // For persisted CRYPT_KEY_PROV_INFO, dwProvType=0 identifies CNG. Windows
  // stores both zero/legacy key specs and CERT_NCRYPT_KEY_SPEC here; the latter
  // is required on the acquired key result, not every persisted association.
  if (info.type !== 0 || ![0, 1, 2, CERT_NCRYPT_KEY_SPEC].includes(info.keySpec) || !info.container || !info.provider) return null;
  return providers.has(info.provider.toLowerCase()) ? info.provider : null;
}

function permitsClientAuthentication(context: unknown): boolean {
  const a = api();
  const size = [0];
  if (!a.getUsage(context, 0, null, size)) return false;
  if (size[0]! < a.koffi.sizeof(a.EnhancedUsage) || size[0]! > MAX_NATIVE_DATA) return false;
  const data = Buffer.alloc(size[0]!);
  a.clearError(0);
  const ok = a.getUsage(context, 0, data, size);
  const code = a.lastError();
  if (!ok) return false;
  const usage = a.koffi.decode(data, a.EnhancedUsage) as { count: number; identifiers: unknown };
  // With flags=0 crypt32 intersects the certificate extension and Windows store
  // property. Zero means unrestricted only when CRYPT_E_NOT_FOUND is reported.
  if (usage.count === 0) return code === CRYPT_E_NOT_FOUND;
  if (usage.count > 4096 || !usage.identifiers) return false;
  const identifiers = a.koffi.decode(usage.identifiers, a.koffi.array("str", usage.count)) as string[];
  return identifiers.includes(CLIENT_AUTH) || identifiers.includes(ANY_USAGE);
}

function describe(context: unknown, providers: Set<string>, at: number): WindowsCertificate | null {
  const a = api();
  const native = a.koffi.decode(context, a.CertContext) as { encoding: number; encoded: unknown; length: number; info: unknown };
  if (!native.encoded || !native.info || native.length === 0 || native.length > MAX_NATIVE_DATA) return null;
  const der = Buffer.from(a.koffi.view(native.encoded, native.length));
  let cert: X509Certificate;
  try { cert = new X509Certificate(der); } catch { return null; }
  if (!["rsa", "rsa-pss", "ec"].includes(cert.publicKey.asymmetricKeyType ?? "")) return null;
  const validFrom = Date.parse(cert.validFrom);
  const validTo = Date.parse(cert.validTo);
  if (!Number.isFinite(at) || at < validFrom || at > validTo) return null;
  const provider = providerFor(context, providers);
  if (!provider || !permitsClientAuthentication(context)) return null;
  const usage = Buffer.alloc(2);
  a.clearError(0);
  const hasUsage = a.getKeyUsage(native.encoding, native.info, usage, usage.length);
  const error = a.lastError();
  // CertGetIntendedKeyUsage reports FALSE/error=0 when no restriction exists.
  if (hasUsage ? (usage[0]! & 0x80) === 0 : error !== 0) return null;
  return {
    id: createHash("sha1").update(der).digest("hex").toUpperCase(),
    subject: cert.subject, issuer: cert.issuer,
    validFrom: new Date(validFrom).toISOString(), validTo: new Date(validTo).toISOString(), provider,
  };
}

/** Public metadata only; context stays owned by the native caller. Never opens a private key. */
export function describeWindowsCertificate(context: unknown, at = Date.now()): WindowsCertificate | null {
  return describe(context, installedProviders(), at);
}

/** Lists current-user CNG client certificates without acquiring keys or prompting for a PIN. */
export async function listWindowsCertificates(): Promise<WindowsCertificate[]> {
  const a = api();
  const providers = installedProviders();
  const store = openPersonalStore();
  let context: unknown = null;
  const certificates = new Map<string, WindowsCertificate>();
  const at = Date.now();
  try {
    let count = 0;
    for (;;) {
      // Every call consumes the preceding enumeration reference, even at EOF.
      context = a.enumerate(store, context);
      if (!context) {
        const code = a.lastError();
        if (code !== CRYPT_E_NOT_FOUND && code !== 18) throw failure("Listing Windows certificates", code);
        break;
      }
      if (++count > 10000) throw new Error("The Windows Personal store contains too many certificates.");
      const cert = describe(context, providers, at);
      if (cert) certificates.set(cert.id, cert);
    }
    return [...certificates.values()].sort((left, right) => left.subject.localeCompare(right.subject) || left.id.localeCompare(right.id));
  } finally {
    if (context) a.freeContext(context);
    a.closeStore(store, 0);
  }
}

export interface RetainedWindowsCertificate {
  /** PCCERT_CONTEXT for Schannel; valid until close(), including any cached CNG key. */
  context: unknown;
  store: unknown;
  certificate: WindowsCertificate;
  close(): void;
}

/** Caller must close this after freeing all Schannel credentials that use it. */
export function lookupWindowsCertificate(id: string): RetainedWindowsCertificate {
  if (!/^[0-9a-f]{40}$/i.test(id)) throw new Error("Select a Windows client certificate before starting the relay.");
  const a = api();
  const providers = installedProviders();
  const store = openPersonalStore();
  let context: unknown = null;
  try {
    const hash = Buffer.from(id, "hex");
    // CERT_FIND_SHA1_HASH. The returned reference is owned by this object.
    context = a.find(store, 0x00010001, 0, 0x00010000, { length: hash.length, data: hash }, null);
    if (!context) throw new Error("The selected Windows certificate is no longer in your Personal certificate store. Refresh the certificate list.");
    const certificate = describe(context, providers, Date.now());
    if (!certificate) throw new Error("The selected Windows certificate is expired or is not a CNG client-authentication certificate. Refresh the certificate list.");
    let closed = false;
    const retainedContext = context;
    return {
      context, store, certificate,
      close() {
        if (closed) return;
        closed = true;
        a.freeContext(retainedContext);
        a.closeStore(store, 0);
      },
    };
  } catch (error) {
    if (context) a.freeContext(context);
    a.closeStore(store, 0);
    throw error;
  }
}
