import { JSCallback, ptr } from "bun:ffi";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { connect as connectSocket, isIP, type Socket } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PassThrough, Writable } from "node:stream";
import type { LaunchSecrets, LaunchSettings, LogEntry } from "../shared/types";
import type { NativeConnector, NativeSession } from "./relay-engine";
import { cString, loadOpenSSL, type NativePointer, type OpenSSL } from "./openssl-ffi";
import { TokenAuthenticationLatch } from "./token-auth";
import { createSchannelConnector } from "./schannel-tls";

const WANT_READ = 2;
const WANT_WRITE = 3;
const ZERO_RETURN = 6;
const STORE_PKEY = 4;
const STORE_CERT = 5;
const FRAME = 16384;
type Log = (source: LogEntry["source"], message: string) => void;

function required(value: NativePointer | null, error: () => Error): NativePointer {
  if (!value) throw error();
  return value;
}

function configQuote(value: string): string {
  return `"${value.replaceAll("\\", "\\\\").replaceAll('"', '\\"').replaceAll("$", "\\$")}"`;
}

class OpenSSLConnector implements NativeConnector {
  private openssl: OpenSSL | null = null;
  private context: NativePointer | null = null;
  private libraryContext: NativePointer | null = null;
  private defaultProvider: NativePointer | null = null;
  private ui: NativePointer | null = null;
  private reader: JSCallback | null = null;
  private readonly pin: Buffer;
  private validation: Promise<void> | null = null;
  private stopped = false;
  private sessions = new Set<OpenSSLSession>();
  private readonly tokenAuthentication: TokenAuthenticationLatch | null;

  constructor(private readonly settings: LaunchSettings, secrets: LaunchSecrets, private readonly log: Log) {
    if (settings.identityMode === "pkcs11") {
      if (!settings.providerPath || !settings.pkcs11ModulePath) throw new Error("Select the PKCS#11 provider and card middleware before starting.");
      if (!settings.privateKey.startsWith("pkcs11:") || !settings.certificate) throw new Error("Select a client certificate and a PKCS#11 private-key URI before starting.");
      if (!secrets.pin) throw new Error("Enter the token PIN before starting. Protected PIN-pad authentication is not configured.");
    } else if (settings.identityMode === "pem" && (!settings.certificate || !settings.privateKey)) {
      throw new Error("Select the PEM client certificate and private key before starting.");
    }
    this.pin = cString(secrets.pin);
    this.tokenAuthentication = settings.identityMode === "pkcs11" ? new TokenAuthenticationLatch(this.pin, () => {
      // Marking the latch and wiping the PIN happen synchronously. Cancellation
      // prevents other pending handshakes from submitting that PIN again.
      for (const session of this.sessions) void session.close();
    }) : null;
  }

  validate(): Promise<void> {
    if (this.tokenAuthentication?.failure) return Promise.reject(this.tokenAuthentication.failure);
    if (this.stopped) return Promise.reject(new Error("Native TLS connector has stopped."));
    this.validation ??= this.initialize().catch(error => { this.release(); throw error; });
    return this.validation;
  }

  getIdentityError(): string | null {
    return this.tokenAuthentication?.failure?.message ?? null;
  }

  private async initialize(): Promise<void> {
    this.openssl = loadOpenSSL(this.settings.sslLibraryPath, this.settings.cryptoLibraryPath);
    const lib = this.openssl;
    const a = lib.api;
    a.ERR_clear_error();
    this.libraryContext = required(a.OSSL_LIB_CTX_new(), () => lib.error("Cannot allocate native OpenSSL context"));
    if (this.settings.identityMode === "pkcs11") {
      const temporary = await mkdtemp(join(tmpdir(), "cac-openssl-"));
      try {
        const path = join(temporary, "openssl.cnf");
        await writeFile(path, [
          "config_diagnostics = 1", "openssl_conf = initialization", "[initialization]", "providers = providers",
          "[providers]", "default = defaults", "pkcs11 = smartcard", "[defaults]", "activate = 1",
          "[smartcard]", `module = ${configQuote(this.settings.providerPath)}`,
          `pkcs11-module-path = ${configQuote(this.settings.pkcs11ModulePath)}`,
          // Load token signature capabilities before SSL_CTX caches supported algorithms.
          "pkcs11-module-cache-pins = cache", "pkcs11-module-load-behavior = early", "activate = 1", "",
        ].join("\n"), { mode: 0o600, flag: "wx" });
        if (this.stopped) throw new Error("Native TLS initialization was cancelled.");
        const name = cString(path);
        if (a.OSSL_LIB_CTX_load_config(this.libraryContext, ptr(name)) !== 1) throw lib.error("Cannot load the PKCS#11 provider or middleware");
      } finally { await rm(temporary, { recursive: true, force: true }); }
    } else {
      const name = cString("default");
      this.defaultProvider = required(a.OSSL_PROVIDER_load(this.libraryContext, ptr(name)), () => lib.error("Cannot load OpenSSL's default provider"));
    }

    if (this.stopped) throw new Error("Native TLS initialization was cancelled.");

    this.context = required(a.SSL_CTX_new_ex(this.libraryContext, null, a.TLS_client_method()), () => lib.error("Cannot create native TLS context"));
    // SSL_CTX_set_min_proto_version is a public macro around SSL_CTX_ctrl.
    if (Number(a.SSL_CTX_ctrl(this.context, 123, 0x0303, null)) !== 1) throw lib.error("Cannot require TLS 1.2 or later");
    a.SSL_CTX_set_verify(this.context, 1, null);
    if (this.settings.caFile) {
      const ca = cString(this.settings.caFile);
      if (a.SSL_CTX_load_verify_locations(this.context, ptr(ca), null) !== 1) throw lib.error("Cannot load the PEM trust bundle");
    } else if (a.SSL_CTX_set_default_verify_paths(this.context) !== 1) {
      throw lib.error("Cannot load OpenSSL's system trust roots. Configure a PEM trust bundle.");
    }

    if (this.settings.identityMode !== "none") {
      const label = cString("CAC SSL Relay");
      this.ui = required(a.UI_create_method(ptr(label)), () => lib.error("Cannot create native PIN reader"));
      this.reader = new JSCallback((ui, entry) => {
        const kind = a.UI_get_string_type(entry);
        if (kind === 1 || kind === 2) return a.UI_set_result(ui, entry, ptr(this.pin)) >= 0 ? 1 : 0;
        return 1;
      }, { args: ["ptr", "ptr"], returns: "int" });
      if (a.UI_method_set_reader(this.ui, this.reader.ptr) !== 0) throw lib.error("Cannot configure native PIN reader");

      if (this.settings.certificate.startsWith("pkcs11:")) {
        const certificate = this.loadObject(this.settings.certificate, STORE_CERT);
        try {
          if (a.SSL_CTX_use_certificate(this.context, certificate) !== 1) throw lib.error("Cannot configure the client certificate");
        } finally { a.X509_free(certificate); }
      } else {
        const path = cString(this.settings.certificate);
        if (a.SSL_CTX_use_certificate_chain_file(this.context, ptr(path)) !== 1) throw lib.error("Cannot load the PEM client certificate chain");
      }
      const key = this.loadObject(this.settings.privateKey, STORE_PKEY);
      try {
        if (a.SSL_CTX_use_PrivateKey(this.context, key) !== 1 || a.SSL_CTX_check_private_key(this.context) !== 1) {
          throw lib.error("The client certificate and private key do not match");
        }
      } finally { a.EVP_PKEY_free(key); }
    }
    if (this.stopped) throw new Error("Native TLS initialization was cancelled.");
    this.log("app", this.settings.identityMode === "pkcs11" ? "Native OpenSSL PKCS#11 identity loaded; private keys remain on the token." : "Native OpenSSL TLS context loaded.");
  }

  private loadObject(identifier: string, type: number): NativePointer {
    const lib = this.openssl!;
    const a = lib.api;
    const uri = cString(identifier);
    a.ERR_clear_error();
    const store = required(a.OSSL_STORE_open_ex(ptr(uri), this.libraryContext, null, this.ui, null, null, null, null), () => lib.error("Cannot open the selected client identity"));
    let object: NativePointer | null = null;
    try {
      if (a.OSSL_STORE_expect(store, type) !== 1) throw lib.error("Cannot select the client identity object type");
      while (!a.OSSL_STORE_eof(store)) {
        const info = a.OSSL_STORE_load(store);
        if (!info) {
          if (a.OSSL_STORE_eof(store)) break;
          throw lib.error("Cannot unlock or load the client identity. Check the token, PIN, and object URI");
        }
        try {
          if (a.OSSL_STORE_INFO_get_type(info) !== type) continue;
          if (object) throw new Error("The selected identity matches multiple objects. Specify a unique PKCS#11 URI.");
          object = type === STORE_PKEY ? a.OSSL_STORE_INFO_get1_PKEY(info) : a.OSSL_STORE_INFO_get1_CERT(info);
          if (!object) throw lib.error("Cannot retain the client identity");
        } finally { a.OSSL_STORE_INFO_free(info); }
      }
      if (!object) throw lib.error("The selected client identity was not found");
      return object;
    } catch (error) {
      if (object) (type === STORE_PKEY ? a.EVP_PKEY_free : a.X509_free)(object);
      throw error;
    } finally { a.OSSL_STORE_close(store); }
  }

  async connect(host: string, port: number, signal?: AbortSignal): Promise<NativeSession> {
    this.tokenAuthentication?.assertAvailable();
    await this.validate();
    this.tokenAuthentication?.assertAvailable();
    if (this.stopped || signal?.aborted) throw new Error("Native TLS connection was cancelled.");
    const session = new OpenSSLSession(this.openssl!, this.context!, host, port, this.log,
      error => this.tokenAuthentication?.observe(error) ?? error, signal);
    this.sessions.add(session);
    void session.closed.then(() => this.sessions.delete(session));
    try { await session.ready; return session; }
    catch (error) {
      await session.close();
      this.tokenAuthentication?.assertAvailable();
      throw error;
    }
  }

  async close(): Promise<void> {
    this.stopped = true;
    await this.validation?.catch(() => {});
    await Promise.all([...this.sessions].map(session => session.close()));
    this.release();
  }

  private release(): void {
    const lib = this.openssl;
    if (!lib) { this.pin.fill(0); return; }
    const a = lib.api;
    if (this.context) { a.SSL_CTX_free(this.context); this.context = null; }
    if (this.defaultProvider) { a.OSSL_PROVIDER_unload(this.defaultProvider); this.defaultProvider = null; }
    if (this.libraryContext) { a.OSSL_LIB_CTX_free(this.libraryContext); this.libraryContext = null; }
    if (this.ui) { a.UI_destroy_method(this.ui); this.ui = null; }
    this.reader?.close(); this.reader = null;
    this.pin.fill(0);
    lib.close(); this.openssl = null;
  }
}

interface PendingWrite { data: Buffer; offset: number; callback: (error?: Error | null) => void }

class OpenSSLSession implements NativeSession {
  readonly input: Writable;
  readonly output = new PassThrough({ highWaterMark: FRAME * 4 });
  readonly ready: Promise<void>;
  readonly closed: Promise<void>;
  private resolveReady!: () => void;
  private rejectReady!: (error: Error) => void;
  private resolveClosed!: () => void;
  private readonly network: Socket;
  private ssl: NativePointer | null = null;
  private incoming: NativePointer | null = null;
  private outgoing: NativePointer | null = null;
  private handshake = false;
  private done = false;
  private closing = false;
  private pumping = false;
  private networkBlocked = false;
  private outputBlocked = false;
  private pendingWrite: PendingWrite | null = null;
  private finalCallback: ((error?: Error | null) => void) | null = null;
  private shutdownSent = false;
  private peerClosed = false;
  private transportClosed = false;
  private readonly handshakeTimer: ReturnType<typeof setTimeout>;
  private readonly abort: () => void;

  constructor(private readonly lib: OpenSSL, context: NativePointer, host: string, port: number, private readonly log: Log, private readonly identityFailure: (error: Error) => Error, private readonly signal?: AbortSignal) {
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
    this.output.on("drain", () => {
      this.outputBlocked = false;
      this.network.resume();
      this.pump();
    });
    host = host.replace(/^\[|\]$/g, "");
    this.network = connectSocket({ host, port, allowHalfOpen: true });
    this.network.on("connect", () => this.pump());
    this.network.on("drain", () => { this.networkBlocked = false; this.pump(); });
    this.network.on("data", data => {
      if (this.done || this.closing || !this.incoming) return;
      const bytes = Buffer.isBuffer(data) ? data : Buffer.from(data);
      if (this.lib.api.BIO_write(this.incoming, ptr(bytes), bytes.length) !== bytes.length) return this.fail(this.lib.error("Native TLS receive buffer failed"));
      this.pump();
    });
    this.network.on("end", () => {
      if (this.incoming && !this.done && !this.closing) {
        this.lib.api.BIO_ctrl(this.incoming, 130, 0, null);
        this.pump();
      }
    });
    this.network.on("error", error => this.fail(error));
    this.network.on("close", () => {
      this.transportClosed = true;
      // Plaintext can remain inside OpenSSL while the consumer applies backpressure.
      // Keep that native state until it has drained, even after TCP has closed.
      this.pump();
      if (!this.outputBlocked || this.closing) this.finish();
    });
    this.abort = () => this.fail(new Error("Native TLS connection was cancelled."));
    this.signal?.addEventListener("abort", this.abort, { once: true });
    this.handshakeTimer = setTimeout(() => this.fail(new Error("Native TLS handshake timed out.")), 15000);
    try {
      const a = lib.api;
      a.ERR_clear_error();
      this.ssl = required(a.SSL_new(context), () => lib.error("Cannot allocate native TLS connection"));
      const incoming = required(a.BIO_new(a.BIO_s_mem()), () => lib.error("Cannot allocate native TLS input"));
      const outgoing = a.BIO_new(a.BIO_s_mem());
      if (!outgoing) { a.BIO_free(incoming); throw lib.error("Cannot allocate native TLS output"); }
      this.incoming = incoming; this.outgoing = outgoing;
      a.SSL_set_bio(this.ssl, incoming, outgoing);
      const name = cString(host);
      if (isIP(host)) {
        if (a.X509_VERIFY_PARAM_set1_ip_asc(a.SSL_get0_param(this.ssl), ptr(name)) !== 1) throw lib.error("Cannot configure TLS IP verification");
      } else {
        if (a.SSL_set1_host(this.ssl, ptr(name)) !== 1 || Number(a.SSL_ctrl(this.ssl, 55, 0, ptr(name))) !== 1) {
          throw lib.error("Cannot configure TLS hostname verification and SNI");
        }
        a.SSL_set_hostflags(this.ssl, 4); // X509_CHECK_FLAG_NO_PARTIAL_WILDCARDS
      }
      a.SSL_set_connect_state(this.ssl);
    } catch (error) { this.fail(error instanceof Error ? error : new Error(String(error))); }
    if (this.signal?.aborted) this.abort();
  }

  private flush(): void {
    if (!this.outgoing || this.networkBlocked || this.done || this.closing) return;
    const a = this.lib.api;
    while (Number(a.BIO_ctrl_pending(this.outgoing)) > 0) {
      const data = Buffer.allocUnsafe(FRAME);
      const read = a.BIO_read(this.outgoing, ptr(data), data.length);
      if (read <= 0) throw this.lib.error("Native TLS send buffer failed");
      if (!this.transportClosed && !this.network.write(data.subarray(0, read))) { this.networkBlocked = true; break; }
    }
  }

  private pump(): void {
    if (this.pumping || this.done || this.closing || !this.ssl || this.network.connecting) return;
    this.pumping = true;
    const a = this.lib.api;
    try {
      this.flush();
      if (this.networkBlocked) return;
      if (!this.handshake) {
        a.ERR_clear_error();
        const result = a.SSL_do_handshake(this.ssl);
        const error = result === 1 ? 0 : a.SSL_get_error(this.ssl, result);
        if (result === 1) {
          if (Number(a.SSL_get_verify_result(this.ssl)) !== 0) throw this.lib.error("TLS peer verification failed");
          this.handshake = true;
          clearTimeout(this.handshakeTimer);
          this.resolveReady();
        } else if (error !== WANT_READ && error !== WANT_WRITE) throw this.lib.error("TLS handshake or peer verification failed");
        this.flush();
        if (!this.handshake || this.networkBlocked) return;
      }

      const written = new BigUint64Array(1);
      while (this.pendingWrite && !this.networkBlocked) {
        const pending = this.pendingWrite;
        if (pending.offset >= pending.data.length) {
          this.pendingWrite = null;
          pending.callback();
          continue;
        }
        const data = pending.data.subarray(pending.offset, pending.offset + FRAME);
        a.ERR_clear_error();
        const result = a.SSL_write_ex(this.ssl, ptr(data), data.length, ptr(written));
        const error = result === 1 ? 0 : a.SSL_get_error(this.ssl, result);
        if (result === 1) pending.offset += Number(written[0]);
        else if (error !== WANT_READ && error !== WANT_WRITE) throw this.lib.error("Native TLS write failed");
        this.flush();
        if (result !== 1) break;
      }

      if (this.finalCallback && !this.pendingWrite && !this.networkBlocked && !this.shutdownSent) {
        a.ERR_clear_error();
        const result = a.SSL_shutdown(this.ssl);
        if (result < 0) {
          const error = a.SSL_get_error(this.ssl, result);
          if (error !== WANT_READ && error !== WANT_WRITE) throw this.lib.error("Native TLS shutdown failed");
        }
        this.shutdownSent = true;
        this.flush();
      }
      if (this.shutdownSent && !this.networkBlocked && Number(a.BIO_ctrl_pending(this.outgoing)) === 0) {
        // Keep TCP open for the peer's remaining data and close_notify. A local
        // TLS write shutdown does not finish the bidirectional TLS shutdown.
        if (this.peerClosed && !this.network.writableEnded) this.network.end();
        const callback = this.finalCallback;
        this.finalCallback = null;
        callback?.();
      }

      if (this.outputBlocked || this.peerClosed) return;
      const read = new BigUint64Array(1);
      for (;;) {
        const data = Buffer.allocUnsafe(FRAME);
        a.ERR_clear_error();
        const result = a.SSL_read_ex(this.ssl, ptr(data), data.length, ptr(read));
        const error = result === 1 ? 0 : a.SSL_get_error(this.ssl, result);
        this.flush();
        if (result === 1) {
          if (!this.output.write(data.subarray(0, Number(read[0])))) {
            this.outputBlocked = true;
            this.network.pause();
            break;
          }
        } else if (error === ZERO_RETURN) {
          this.peerClosed = true;
          this.output.end();
          if (!this.input.writableEnded) this.input.end();
          queueMicrotask(() => this.pump());
          break;
        } else if (error === WANT_READ || error === WANT_WRITE) break;
        else throw this.lib.error("Native TLS read failed");
      }
    } catch (error) { this.fail(error instanceof Error ? error : new Error(String(error))); }
    finally {
      this.pumping = false;
      if (this.transportClosed && (!this.outputBlocked || this.closing)) this.finish();
    }
  }

  private fail(error: Error): void {
    if (this.done || this.closing) return;
    this.closing = true;
    error = this.identityFailure(error);
    this.rejectReady(error);
    this.log("stderr", error.message);
    this.input.destroy(error);
    this.output.destroy(error);
    this.network.destroy();
  }

  private finish(): void {
    if (this.done) return;
    this.done = true;
    clearTimeout(this.handshakeTimer);
    this.signal?.removeEventListener("abort", this.abort);
    this.rejectReady(new Error("Native TLS connection closed before its handshake completed."));
    if (this.ssl) { this.lib.api.SSL_free(this.ssl); this.ssl = null; }
    this.incoming = null; this.outgoing = null;
    const pending = this.pendingWrite;
    this.pendingWrite = null;
    pending?.callback(new Error("Native TLS connection closed."));
    const final = this.finalCallback;
    this.finalCallback = null;
    final?.();
    if (!this.output.writableEnded && !this.output.destroyed) this.output.end();
    if (!this.input.destroyed) this.input.destroy();
    this.resolveClosed();
  }

  async close(): Promise<void> {
    if (!this.done) {
      this.closing = true;
      this.rejectReady(new Error("Native TLS connection was closed."));
      this.network.destroy();
      if (this.transportClosed) this.finish();
    }
    await this.closed;
  }
}

export function createNativeConnector(settings: LaunchSettings, secrets: LaunchSecrets, log: Log): NativeConnector {
  if (settings.identityMode === "ncrypt") return createSchannelConnector(settings, secrets, log);
  return new OpenSSLConnector(settings, secrets, log);
}
