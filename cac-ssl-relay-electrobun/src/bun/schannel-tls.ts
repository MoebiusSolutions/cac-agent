import { connect as connectSocket, type Socket } from "node:net";
import { PassThrough, Writable } from "node:stream";
import type { LaunchSecrets, LaunchSettings, LogEntry } from "../shared/types";
import type { NativeConnector, NativeSession } from "./relay-engine";
import { lookupWindowsCertificate, type RetainedWindowsCertificate } from "./windows-certificates";
import { loadWindowsKoffi } from "./windows-ffi";
import { createWindowsTrust } from "./windows-trust";

type Log = (source: LogEntry["source"], message: string) => void;
const FRAME = 16384;
const MAX_INPUT = 4 * 1024 * 1024;
const OK = 0;
const CONTINUE = 0x00090312;
const COMPLETE = 0x00090313;
const COMPLETE_CONTINUE = 0x00090314;
const EXPIRED = 0x00090317;
const INCOMPLETE_CREDENTIALS = 0x00090320;
const RENEGOTIATE = 0x00090321;
const INCOMPLETE_MESSAGE = 0x80090318;
const EMPTY = 0;
const DATA = 1;
const TOKEN = 2;
const EXTRA = 5;
const TRAILER = 6;
const HEADER = 7;
const ALERT = 17;
// SSPI stream integrity/confidentiality and allocated output. NO_DEFAULT_CREDS
// on the credentials prevents automatic selection of a different identity.
const REQUEST = 0x4 | 0x8 | 0x10 | 0x100 | 0x4000 | 0x8000 | 0x10000;

function bindSchannel() {
  const koffi = loadWindowsKoffi();
  if (koffi.sizeof("void *") !== 8) throw new Error("Windows TLS requires a 64-bit application.");
  const SecBuffer = koffi.struct("CAC_SCHANNEL_SEC_BUFFER", { size: "uint32", type: "uint32", data: "void *" });
  const Descriptor = koffi.struct("CAC_SCHANNEL_SEC_BUFFER_DESC", { version: "uint32", count: "uint32", buffers: "void *" });
  const TlsParameters = koffi.struct("CAC_SCHANNEL_TLS_PARAMETERS", {
    alpnCount: "uint32", alpn: "void *", disabledProtocols: "uint32", cryptoCount: "uint32", crypto: "void *", flags: "uint32",
  });
  const Credentials = koffi.struct("CAC_SCHANNEL_CREDENTIALS", {
    version: "uint32", format: "uint32", count: "uint32", certificates: "void *", roots: "void *",
    mapperCount: "uint32", mappers: "void *", sessionLifespan: "uint32", flags: "uint32",
    parameterCount: "uint32", parameters: "void *",
  });
  // Keep DLLs loaded for the process. Asynchronous PIN operations may outlive
  // cancellation of their TCP connection and must retain their native code.
  const secur32 = koffi.load("secur32.dll");
  const crypt32 = koffi.load("crypt32.dll");
  const ncrypt = koffi.load("ncrypt.dll");
  const bind = (name: string, args: string[]) => secur32.func("__stdcall", name, "int32", args);
  return {
    koffi, secur32, crypt32, ncrypt, SecBuffer, Descriptor, TlsParameters, Credentials,
    acquire: bind("AcquireCredentialsHandleW", ["str16", "str16", "uint32", "void *", "void *", "void *", "void *", "void *", "void *"]),
    initialize: bind("InitializeSecurityContextW", ["void *", "void *", "str16", "uint32", "uint32", "uint32", "void *", "uint32", "void *", "void *", "void *", "void *"]),
    complete: bind("CompleteAuthToken", ["void *", "void *"]),
    query: bind("QueryContextAttributesW", ["void *", "uint32", "void *"]),
    encrypt: bind("EncryptMessage", ["void *", "uint32", "void *", "uint32"]),
    decrypt: bind("DecryptMessage", ["void *", "void *", "uint32", "void *"]),
    control: bind("ApplyControlToken", ["void *", "void *"]),
    freeBuffer: bind("FreeContextBuffer", ["void *"]),
    freeCredentials: bind("FreeCredentialsHandle", ["void *"]),
    deleteContext: bind("DeleteSecurityContext", ["void *"]),
    acquireKey: crypt32.func("__stdcall", "CryptAcquireCertificatePrivateKey", "int32", ["void *", "uint32", "void *", "_Out_ uintptr_t *", "_Out_ uint32 *", "_Out_ int32 *"]),
    freeKey: ncrypt.func("__stdcall", "NCryptFreeObject", "int32", ["uintptr_t"]),
    freeCertificate: crypt32.func("__stdcall", "CertFreeCertificateContext", "int32", ["void *"]),
  };
}

let bindings: ReturnType<typeof bindSchannel> | undefined;
type Schannel = ReturnType<typeof bindSchannel>;
function api(): Schannel { return bindings ??= bindSchannel(); }

async function invoke(fn: any, ...args: any[]): Promise<number> {
  return new Promise((resolve, reject) => fn.async(...args, (error: Error | null, status: number) => error ? reject(error) : resolve(status >>> 0)));
}

class WindowsTlsError extends Error {
  constructor(message: string, readonly status: number) {
    super(`${message} (Windows error 0x${(status >>> 0).toString(16).padStart(8, "0")}).`);
  }
}

function check(status: number, message: string): void {
  if ((status >>> 0) !== OK) throw new WindowsTlsError(message, status);
}

function isIdentityStatus(status: number): boolean {
  return ((status & 0xffff0000) >>> 0) === 0x80090000 || ((status & 0xffff0000) >>> 0) === 0x80100000 ||
    status === 0x8009030c || status === 0x800704c7 || status === INCOMPLETE_CREDENTIALS;
}

interface Entry { size: number; type: number; data: unknown }

/** The descriptor, its array and all pointed-to buffers remain live until SSPI returns. */
class Message {
  readonly buffers: Buffer;
  readonly descriptor: Buffer;
  constructor(private readonly a: Schannel, readonly entries: Entry[]) {
    this.buffers = Buffer.alloc(a.koffi.sizeof(a.SecBuffer) * entries.length);
    this.descriptor = Buffer.alloc(a.koffi.sizeof(a.Descriptor));
    a.koffi.encode(this.buffers, a.koffi.array(a.SecBuffer, entries.length), entries);
    a.koffi.encode(this.descriptor, a.Descriptor, { version: 0, count: entries.length, buffers: this.buffers });
  }
  read(): Entry[] { return this.a.koffi.decode(this.buffers, this.a.SecBuffer, this.entries.length) as Entry[]; }
}

function empty(type = EMPTY): Entry { return { size: 0, type, data: null }; }
function bytes(a: Schannel, entry: Entry): Buffer {
  if (!entry.size) return Buffer.alloc(0);
  if (!entry.data || entry.size > MAX_INPUT) throw new Error("Schannel returned an invalid buffer.");
  // Buffer.from(ArrayBuffer) shares memory. Copy before SSPI frees an output
  // allocation or reuses a plaintext record while a stream write is pending.
  return Buffer.from(new Uint8Array(a.koffi.view(entry.data, entry.size)));
}

class SchannelConnector implements NativeConnector {
  private a: Schannel | null = null;
  private certificate: RetainedWindowsCertificate | null = null;
  private trust: Awaited<ReturnType<typeof createWindowsTrust>> | null = null;
  private anonymous: Buffer | null = null;
  private authenticated: Buffer | null = null;
  private identityCredentials: Promise<Buffer> | null = null;
  private identityQueue: Promise<void> = Promise.resolve();
  private validation: Promise<void> | null = null;
  private failure: Error | null = null;
  private stopped = false;
  private sessions = new Set<SchannelSession>();

  constructor(private readonly settings: LaunchSettings, private readonly log: Log) {
    if (process.platform !== "win32") throw new Error("Windows certificate-store authentication is available only on Windows.");
    if (!settings.windowsCertificateId) throw new Error("Select a Windows client certificate before starting.");
  }

  validate(): Promise<void> {
    if (this.failure) return Promise.reject(this.failure);
    if (this.stopped) return Promise.reject(new Error("Windows TLS connector has stopped."));
    this.validation ??= this.initialize().catch(async error => { await this.release(); throw error; });
    return this.validation;
  }

  private async initialize(): Promise<void> {
    this.a = api();
    this.certificate = lookupWindowsCertificate(this.settings.windowsCertificateId);
    this.trust = await createWindowsTrust(this.settings.caFile);
    if (this.stopped) throw new Error("Windows TLS initialization was cancelled.");
    this.anonymous = await this.acquireCredentials(false);
    if (this.stopped) throw new Error("Windows TLS initialization was cancelled.");
    this.log("app", "Windows Schannel TLS loaded. Windows manages the selected certificate's private key and PIN dialog.");
  }

  private async acquireCredentials(authenticate: boolean): Promise<Buffer> {
    const a = this.a!;
    const parameters = Buffer.alloc(a.koffi.sizeof(a.TlsParameters));
    // Disable PCT, SSL 2/3, TLS 1.0/1.1, and DTLS; retain Windows policy for
    // TLS 1.2 and newer, including TLS 1.3 on supported Windows versions.
    a.koffi.encode(parameters, a.TlsParameters, { alpnCount: 0, alpn: null, disabledProtocols: 0x000f03ff, cryptoCount: 0, crypto: null, flags: 0 });
    const certificates = Buffer.alloc(8);
    if (authenticate) a.koffi.encode(certificates, "void *", this.certificate!.context);
    const credentials = Buffer.alloc(a.koffi.sizeof(a.Credentials));
    a.koffi.encode(credentials, a.Credentials, {
      version: 5, format: 0, count: authenticate ? 1 : 0, certificates: authenticate ? certificates : null,
      roots: null, mapperCount: 0, mappers: null, sessionLifespan: 0,
      flags: (this.settings.caFile ? 0x00000008 : 0x00000020) | 0x00000010 | 0x00400000, parameterCount: 1, parameters,
    });
    const handle = Buffer.alloc(16, 0xff);
    const expiry = Buffer.alloc(8);
    check(await invoke(a.acquire, null, "Microsoft Unified Security Protocol Provider", 2, null, credentials, null, null, handle, expiry), "Acquiring Windows TLS credentials");
    return handle;
  }

  getIdentityError(): string | null { return this.failure?.message ?? null; }

  private identityFailure(error: Error): Error {
    // An OS PIN cancellation/removal/key error requires an explicit Restart;
    // new incoming connections cannot repeatedly reopen the same PIN dialog.
    if (!this.failure) {
      this.failure = new Error(`${error.message} Reinsert the card if needed, then Restart to try Windows authentication again.`);
      for (const session of this.sessions) void session.close();
    }
    return this.failure;
  }

  private async authenticatedCredentials(): Promise<Buffer> {
    if (this.failure) throw this.failure;
    if (this.stopped) throw new Error("Windows TLS connector has stopped.");
    this.identityCredentials ??= (async () => {
      const key: (number | bigint)[] = [0];
      const keySpec = [0];
      const callerFree = [0];
      // CACHE owns the NCrypt handle on the retained CERT_CONTEXT. ONLY_NCRYPT
      // excludes a legacy CSP fallback; no SILENT flag allows the system PIN UI.
      const acquired = await invoke(this.a!.acquireKey, this.certificate!.context, 0x1 | 0x4 | 0x8 | 0x40000, null, key, keySpec, callerFree);
      if (!acquired || keySpec[0] !== 0xffffffff || callerFree[0] !== 0 || !key[0]) {
        if (callerFree[0] && key[0] && keySpec[0] === 0xffffffff) this.a!.freeKey(key[0]);
        throw new Error("Windows could not open the selected CNG key. Check the card and the Windows PIN dialog");
      }
      if (this.stopped) throw new Error("Windows authentication was cancelled.");
      this.authenticated = await this.acquireCredentials(true);
      return this.authenticated;
    })().catch(error => { throw this.identityFailure(error instanceof Error ? error : new Error(String(error))); });
    return this.identityCredentials;
  }

  private initializeAuthenticated(operation: () => Promise<number>): Promise<number> {
    const result = this.identityQueue.then(async () => {
      if (this.failure) throw this.failure;
      if (this.stopped) throw new Error("Windows authentication was cancelled.");
      const status = await operation();
      // Mark the failure before the next queued call can enter a KSP. Windows
      // owns PIN retries; the application never automatically repeats one.
      if (isIdentityStatus(status)) this.identityFailure(new WindowsTlsError("Windows client-certificate authentication failed", status));
      return status;
    });
    this.identityQueue = result.then(() => {}, () => {});
    return result;
  }

  async connect(host: string, port: number, signal?: AbortSignal): Promise<NativeSession> {
    await this.validate();
    if (this.failure) throw this.failure;
    if (this.stopped || signal?.aborted) throw new Error("Windows TLS connection was cancelled.");
    const session = new SchannelSession(this.a!, this.anonymous!, () => this.authenticatedCredentials(), operation => this.initializeAuthenticated(operation), this.trust!, !!this.settings.caFile, host, port, this.log,
      error => this.identityFailure(error), signal);
    this.sessions.add(session);
    void session.closed.then(() => this.sessions.delete(session));
    try { await session.ready; return session; }
    catch (error) { await session.close(); throw this.failure ?? error; }
  }

  async close(): Promise<void> {
    this.stopped = true;
    // Destroy sockets immediately, but native contexts/credentials remain live
    // until asynchronous SSPI and any system PIN operation have returned.
    const closing = [...this.sessions].map(session => session.close());
    await this.validation?.catch(() => {});
    await this.identityCredentials?.catch(() => {});
    await Promise.all(closing);
    await this.release();
  }

  private async release(): Promise<void> {
    if (this.authenticated) { this.a!.freeCredentials(this.authenticated); this.authenticated = null; }
    if (this.anonymous) { this.a!.freeCredentials(this.anonymous); this.anonymous = null; }
    this.certificate?.close(); this.certificate = null;
    await this.trust?.close(); this.trust = null;
  }
}

interface PendingWrite { data: Buffer; offset: number; callback: (error?: Error | null) => void }

class SchannelSession implements NativeSession {
  readonly input: Writable;
  readonly output = new PassThrough({ highWaterMark: FRAME * 4 });
  readonly ready: Promise<void>;
  readonly closed: Promise<void>;
  private resolveReady!: () => void;
  private rejectReady!: (error: Error) => void;
  private resolveClosed!: () => void;
  private readonly network: Socket;
  private readonly context = Buffer.alloc(16, 0xff);
  private contextCreated = false;
  private handshake = false;
  private handshakePending = true;
  private initialHandshake = true;
  private suppliedCertificate = false;
  private credentials: Buffer;
  private incoming: Buffer = Buffer.alloc(0);
  private header = 0;
  private trailer = 0;
  private maximum = FRAME;
  private pumping = false;
  private requested = false;
  private done = false;
  private closing = false;
  private networkBlocked = false;
  private outputBlocked = false;
  private pendingWrite: PendingWrite | null = null;
  private finalCallback: ((error?: Error | null) => void) | null = null;
  private shutdownSent = false;
  private peerClosed = false;
  private transportEnded = false;
  private transportClosed = false;
  private readonly handshakeTimer: ReturnType<typeof setTimeout>;
  private readonly abort: () => void;
  private readonly host: string;

  constructor(private readonly a: Schannel, credentials: Buffer, private readonly authenticate: () => Promise<Buffer>,
    private readonly initializeAuthenticated: (operation: () => Promise<number>) => Promise<number>,
    private readonly trust: Awaited<ReturnType<typeof createWindowsTrust>>, private readonly manualValidation: boolean,
    host: string, port: number, private readonly log: Log,
    private readonly identityFailure: (error: Error) => Error, private readonly signal?: AbortSignal) {
    this.host = host.replace(/^\[|\]$/g, "");
    this.credentials = credentials;
    this.ready = new Promise((resolve, reject) => { this.resolveReady = resolve; this.rejectReady = reject; });
    this.closed = new Promise(resolve => { this.resolveClosed = resolve; });
    this.input = new Writable({
      highWaterMark: FRAME * 4,
      write: (data: Buffer, _encoding, callback) => {
        this.pendingWrite = { data: Buffer.isBuffer(data) ? data : Buffer.from(data), offset: 0, callback };
        this.pump();
      },
      final: callback => { this.finalCallback = callback; this.pump(); },
    });
    this.input.on("error", () => {});
    this.output.on("error", () => {});
    this.output.on("drain", () => { this.outputBlocked = false; this.network.resume(); this.pump(); });
    this.network = connectSocket({ host: this.host, port, allowHalfOpen: true });
    this.network.on("connect", () => this.pump());
    this.network.on("drain", () => { this.networkBlocked = false; this.pump(); });
    this.network.on("data", data => {
      if (this.done || this.closing) return;
      const bytes = Buffer.isBuffer(data) ? data : Buffer.from(data);
      if (this.incoming.length + bytes.length > MAX_INPUT) return this.fail(new Error("Windows TLS input exceeded its buffer limit."));
      this.incoming = this.incoming.length ? Buffer.concat([this.incoming, bytes]) : bytes;
      this.pump();
    });
    this.network.on("end", () => { this.transportEnded = true; this.pump(); });
    this.network.on("error", error => this.fail(error));
    this.network.on("close", () => { this.transportClosed = true; this.pump(); this.maybeFinish(); });
    this.abort = () => this.fail(new Error("Windows TLS connection was cancelled."));
    signal?.addEventListener("abort", this.abort, { once: true });
    this.handshakeTimer = setTimeout(() => this.fail(new Error("Windows TLS handshake timed out. Close any pending Windows PIN dialog and Restart.")), 60000);
    if (signal?.aborted) this.abort();
  }

  private pump(): void {
    this.requested = true;
    if (this.pumping || this.done) return;
    this.pumping = true;
    void this.run();
  }

  private async run(): Promise<void> {
    try {
      do {
        this.requested = false;
        if (!this.closing && !this.network.connecting) await this.step();
      } while (this.requested && !this.closing && !this.done);
    } catch (error) { this.fail(error instanceof Error ? error : new Error(String(error))); }
    finally { this.pumping = false; this.maybeFinish(); }
  }

  private send(data: Buffer): void {
    if (!data.length || this.closing || this.transportClosed) return;
    if (!this.network.write(data)) this.networkBlocked = true;
  }

  private sendOutput(message: Message): void {
    const entries = message.read();
    try { for (const entry of entries) if (entry.type === TOKEN) this.send(bytes(this.a, entry)); }
    finally { for (const entry of entries) if (entry.data) this.a.freeBuffer(entry.data); }
  }

  private retainExtra(input: Buffer, message: Message): void {
    const extra = message.read().find(entry => (entry.type & 0xfffffff) === EXTRA);
    if (!extra?.size) return;
    if (extra.size > input.length) throw new Error("Schannel returned an invalid extra-data size.");
    const retained = Buffer.from(input.subarray(input.length - extra.size));
    this.incoming = this.incoming.length ? Buffer.concat([retained, this.incoming]) : retained;
  }

  private async verifyPeer(): Promise<void> {
    const remote = Buffer.alloc(8);
    check(this.a.query(this.context, 0x53, remote), "Reading the TLS server certificate");
    const certificate = this.a.koffi.decode(remote, "void *");
    if (!certificate) throw new Error("The TLS server did not provide a certificate.");
    try { await this.trust.validate(certificate, this.host); }
    finally { this.a.freeCertificate(certificate); }
  }

  private async negotiate(shutdown = false): Promise<number> {
    const data = shutdown ? Buffer.alloc(0) : this.incoming;
    if (!shutdown) this.incoming = Buffer.alloc(0);
    const incoming = new Message(this.a, [{ size: data.length, type: TOKEN, data: data.length ? data : null }, empty()]);
    const outgoing = new Message(this.a, [empty(TOKEN), empty(ALERT)]);
    const attributes = Buffer.alloc(4);
    const expiry = Buffer.alloc(8);
    const initialize = () => invoke(this.a.initialize, this.credentials, this.contextCreated ? this.context : null, this.host,
      REQUEST | (this.suppliedCertificate ? 0x80 : 0) | (this.manualValidation ? 0x80000 : 0), 0, 0,
      this.contextCreated && !shutdown ? incoming.descriptor : null, 0, this.context, outgoing.descriptor, attributes, expiry);
    let status = await (this.suppliedCertificate ? this.initializeAuthenticated(initialize) : initialize());
    // Even informational/failing later legs can leave an allocated context.
    if (!this.context.equals(Buffer.alloc(16, 0xff))) this.contextCreated = true;
    try {
      if (status === COMPLETE || status === COMPLETE_CONTINUE) {
        check(this.a.complete(this.context, outgoing.descriptor), "Completing Windows TLS authentication");
        status = status === COMPLETE ? OK : CONTINUE;
      }
    } finally { this.sendOutput(outgoing); }
    if (this.closing) return status;
    if (status === INCOMPLETE_MESSAGE || status === INCOMPLETE_CREDENTIALS) {
      this.incoming = this.incoming.length ? Buffer.concat([data, this.incoming]) : data;
    } else if (!shutdown) this.retainExtra(data, incoming);
    if (status === OK && !shutdown) {
      // Schannel supplies record integrity through its TLS cipher suite but
      // does not return ISC_RET_INTEGRITY, even when ISC_REQ_INTEGRITY is set.
      if ((attributes.readUInt32LE(0) & (0x10 | 0x8000)) !== (0x10 | 0x8000)) {
        throw new Error("Windows TLS did not negotiate the required stream encryption.");
      }
      await this.verifyPeer();
      if (this.closing) return status;
      const sizes = Buffer.alloc(20);
      check(this.a.query(this.context, 4, sizes), "Reading Windows TLS stream sizes");
      this.header = sizes.readUInt32LE(0); this.trailer = sizes.readUInt32LE(4); this.maximum = sizes.readUInt32LE(8);
      if (!this.maximum || this.maximum > MAX_INPUT || this.header + this.trailer > MAX_INPUT) throw new Error("Windows TLS returned invalid record sizes.");
      this.handshake = true;
      this.handshakePending = false;
      if (this.initialHandshake) { this.initialHandshake = false; clearTimeout(this.handshakeTimer); this.resolveReady(); }
    }
    return status;
  }

  private async step(): Promise<void> {
    if (this.networkBlocked) return;
    if (!this.handshake) {
      while (!this.closing && !this.networkBlocked && (this.handshakePending || this.incoming.length)) {
        this.handshakePending = false;
        const status = await this.negotiate();
        if (this.closing) return;
        if (status === INCOMPLETE_CREDENTIALS) {
          if (this.suppliedCertificate) throw this.identityFailure(new Error("The server did not accept the selected Windows client certificate"));
          this.credentials = await this.authenticate();
          if (this.closing) return;
          this.suppliedCertificate = true;
          this.handshakePending = true;
          continue;
        }
        if (status === INCOMPLETE_MESSAGE) break;
        if (status !== OK && status !== CONTINUE) {
          const error = new WindowsTlsError("Windows TLS handshake or server verification failed", status);
          if (this.suppliedCertificate && isIdentityStatus(status)) throw this.identityFailure(error);
          throw error;
        }
        if (this.handshake) break;
        if (!this.incoming.length) break;
      }
      if (!this.handshake) {
        if (this.transportEnded) throw new Error("The server closed its connection during the Windows TLS handshake.");
        return;
      }
    }

    while (this.pendingWrite && !this.networkBlocked && !this.closing) {
      const pending = this.pendingWrite;
      if (pending.offset === pending.data.length) { this.pendingWrite = null; pending.callback(); continue; }
      const length = Math.min(this.maximum, pending.data.length - pending.offset);
      const record = Buffer.allocUnsafe(this.header + length + this.trailer);
      pending.data.copy(record, this.header, pending.offset, pending.offset + length);
      const message = new Message(this.a, [
        { size: this.header, type: HEADER, data: record.subarray(0, this.header) },
        { size: length, type: DATA, data: record.subarray(this.header, this.header + length) },
        { size: this.trailer, type: TRAILER, data: record.subarray(this.header + length) }, empty(),
      ]);
      check(this.a.encrypt(this.context, 0, message.descriptor, 0), "Encrypting Windows TLS data");
      this.send(Buffer.concat(message.read().filter(entry => entry.type !== EMPTY).map(entry => bytes(this.a, entry))));
      pending.offset += length;
    }

    if (this.finalCallback && !this.pendingWrite && !this.networkBlocked && !this.shutdownSent) {
      const shutdown = Buffer.alloc(4); shutdown.writeUInt32LE(1);
      const control = new Message(this.a, [{ size: 4, type: TOKEN, data: shutdown }]);
      check(this.a.control(this.context, control.descriptor), "Starting Windows TLS shutdown");
      const status = await this.negotiate(true);
      if (this.closing) return;
      if (status !== OK && status !== EXPIRED && status !== CONTINUE) throw new WindowsTlsError("Closing Windows TLS write stream", status);
      this.shutdownSent = true;
    }
    if (this.shutdownSent && !this.networkBlocked) {
      const final = this.finalCallback; this.finalCallback = null; final?.();
      if (this.peerClosed && !this.network.writableEnded) this.network.end();
    }

    while (this.incoming.length && !this.outputBlocked && !this.peerClosed && !this.closing) {
      const input = this.incoming; this.incoming = Buffer.alloc(0);
      const message = new Message(this.a, [{ size: input.length, type: DATA, data: input }, empty(), empty(), empty()]);
      const status = this.a.decrypt(this.context, message.descriptor, 0, null) >>> 0;
      if (status === INCOMPLETE_MESSAGE) { this.incoming = input; break; }
      if (status !== OK && status !== RENEGOTIATE && status !== EXPIRED) throw new WindowsTlsError("Decrypting Windows TLS data", status);
      if (status === OK) {
        for (const entry of message.read()) {
          if ((entry.type & 0xfffffff) === DATA && entry.size) {
            if (!this.output.write(bytes(this.a, entry))) { this.outputBlocked = true; this.network.pause(); }
          }
        }
      }
      const extra = message.read().find(entry => (entry.type & 0xfffffff) === EXTRA && entry.size);
      if (status === RENEGOTIATE && !extra) {
        // Schannel can return a post-handshake token without EXTRA. Retain the
        // same in-place modified bytes and pass them to ISC as TOKEN, rather
        // than dropping them or exposing handshake data as application data.
        const token = message.read().find(entry => (entry.type & 0xfffffff) === TOKEN && entry.size);
        this.incoming = token ? bytes(this.a, token) : input;
      } else this.retainExtra(input, message);
      if (status === EXPIRED) {
        this.peerClosed = true;
        this.output.end();
        if (!this.input.writableEnded) this.input.end();
        this.requested = true;
        break;
      }
      if (status === RENEGOTIATE) {
        this.handshake = false;
        this.handshakePending = true;
        this.requested = true;
        break;
      }
    }
    // A coalesced final flight can contain TLS 1.3 post-handshake messages,
    // application records and close_notify. Process the pending SSPI handshake
    // and its EXTRA bytes before deciding that the TCP EOF was a truncation.
    if (this.transportEnded && this.handshake && !this.outputBlocked && !this.peerClosed) {
      throw new Error("The TLS server closed TCP without a TLS close notification.");
    }
  }

  private fail(error: Error): void {
    if (this.done || this.closing) return;
    this.closing = true;
    this.rejectReady(error);
    this.log("stderr", error.message);
    this.input.destroy(error); this.output.destroy(error); this.network.destroy();
    this.maybeFinish();
  }

  private maybeFinish(): void {
    if (this.done || this.pumping || !this.transportClosed || (!this.closing && this.outputBlocked)) return;
    this.done = true;
    clearTimeout(this.handshakeTimer);
    this.signal?.removeEventListener("abort", this.abort);
    this.rejectReady(new Error("Windows TLS connection closed before its handshake completed."));
    if (this.contextCreated) { this.a.deleteContext(this.context); this.contextCreated = false; }
    const pending = this.pendingWrite; this.pendingWrite = null; pending?.callback(new Error("Windows TLS connection closed."));
    const final = this.finalCallback; this.finalCallback = null; final?.();
    this.incoming = Buffer.alloc(0);
    if (!this.output.writableEnded && !this.output.destroyed) this.output.end();
    if (!this.input.destroyed) this.input.destroy();
    this.resolveClosed();
  }

  async close(): Promise<void> {
    if (!this.done) {
      this.closing = true;
      this.rejectReady(new Error("Windows TLS connection was closed."));
      this.network.destroy();
      this.maybeFinish();
    }
    await this.closed;
  }
}

export function createSchannelConnector(settings: LaunchSettings, _secrets: LaunchSecrets, log: Log): NativeConnector {
  return new SchannelConnector(settings, log);
}
