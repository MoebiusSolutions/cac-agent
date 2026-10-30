import { readFile } from "node:fs/promises";
import { createServer, type Server, type Socket } from "node:net";
import { createServer as createTlsServer } from "node:tls";
import type { Readable, Writable } from "node:stream";
import { finished } from "node:stream/promises";
import type { Configuration, LaunchSecrets, LaunchSettings, LogEntry, RelayBinding, RelayState } from "../shared/types";
import { validateBindings } from "./configuration";
import { createNativeConnector } from "./native-tls";
import { negotiateSocks5, Socks5Error, socks5Reply, type Destination } from "./socks5";

export interface NativeSession {
  input: Writable;
  output: Readable;
  closed: Promise<void>;
  close(): Promise<void>;
}

export interface NativeConnector {
  validate(): Promise<void>;
  connect(host: string, port: number, signal?: AbortSignal): Promise<NativeSession>;
  close(): Promise<void>;
  /** A held token failure that requires an explicit restart to retry authentication. */
  getIdentityError?(): string | null;
}

export type ConnectorFactory = (
  settings: LaunchSettings,
  secrets: LaunchSecrets,
  log: (source: LogEntry["source"], message: string) => void,
) => NativeConnector;

interface Run {
  connector: NativeConnector;
  servers: Set<Server>;
  clients: Set<Socket>;
  pendingTls: Set<Socket>;
  sessions: Set<NativeSession>;
  tasks: Set<Promise<void>>;
  binds: Set<Promise<void>>;
  stopping: boolean;
  cleanup: Promise<void> | null;
}

function endpoint(value: string): Destination {
  const parsed = new URL(`tcp://${value}`);
  return { host: parsed.hostname.replace(/^\[|\]$/g, ""), port: Number(parsed.port) };
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export class RelayEngine {
  private state: RelayState = { status: "stopped", startedAt: null, error: null, listeners: [], connections: 0, logs: [] };
  private run: Run | null = null;
  private nextLogId = 1;
  private secrets: string[] = [];

  constructor(private readonly connectorFactory: ConnectorFactory = createNativeConnector) {}

  snapshot(): RelayState {
    const identityError = this.run?.connector.getIdentityError?.();
    return { ...this.state, error: identityError ? this.clean(identityError) : this.state.error, connections: this.run?.clients.size ?? 0, listeners: [...this.state.listeners], logs: this.state.logs.map(entry => ({ ...entry })) };
  }

  isActive(): boolean { return this.run !== null; }

  clearLogs(): RelayState { this.state.logs = []; return this.snapshot(); }

  private clean(message: string): string {
    let text = message;
    for (const secret of this.secrets) text = text.replaceAll(secret, "[redacted]");
    return text.replace(/[\x00-\x08\x0b-\x1f\x7f]/g, "").slice(0, 16384);
  }

  private log = (source: LogEntry["source"], message: string): void => {
    this.state.logs.push({ id: this.nextLogId++, time: new Date().toISOString(), source, message: this.clean(message) });
    if (this.state.logs.length > 500) this.state.logs.splice(0, this.state.logs.length - 500);
  };

  async start(settings: LaunchSettings, configuration: Configuration, secrets: LaunchSecrets): Promise<RelayState> {
    if (this.run) throw new Error("The relay is already active.");
    if (!configuration.exists || !configuration.bindings.length) throw new Error("Add and save at least one relay binding before starting.");
    validateBindings(configuration.bindings);
    for (const value of [secrets.pin, secrets.localKeyPassphrase]) {
      if (typeof value !== "string" || /[\0\r\n]/.test(value)) throw new Error("Session secrets cannot contain NUL or line breaks.");
    }
    this.secrets = [secrets.pin, secrets.localKeyPassphrase].filter(Boolean).sort((a, b) => b.length - a.length);
    this.state = { ...this.state, status: "starting", error: null, listeners: [], startedAt: null, connections: 0 };
    let connector: NativeConnector;
    try { connector = this.connectorFactory(settings, secrets, this.log); }
    catch (error) {
      this.state.status = "failed";
      this.state.error = this.clean(errorMessage(error));
      this.log("app", this.state.error);
      this.secrets = [];
      throw new Error(this.state.error);
    }
    const run: Run = { connector, servers: new Set(), clients: new Set(), pendingTls: new Set(), sessions: new Set(), tasks: new Set(), binds: new Set(), stopping: false, cleanup: null };
    this.run = run;
    try {
      await connector.validate();
      if (run.stopping || this.run !== run) throw new Error("Relay startup was cancelled.");
      let localTls: { cert: Buffer; key: Buffer; passphrase: string } | undefined;
      if (configuration.bindings.some(binding => binding.kind === "sslRelay")) {
        if (!settings.localCertificatePath || !settings.localKeyPath) throw new Error("Local TLS listeners require a PEM server certificate and private key.");
        localTls = {
          cert: await readFile(settings.localCertificatePath), key: await readFile(settings.localKeyPath), passphrase: secrets.localKeyPassphrase,
        };
      }
      for (const binding of configuration.bindings) {
        if (run.stopping || this.run !== run) throw new Error("Relay startup was cancelled.");
        const accept = (client: Socket): void => {
          if (run.stopping || this.run !== run || this.state.status !== "running" || run.clients.size >= 256) { client.destroy(); return; }
          client.pause();
          client.setNoDelay(true);
          run.clients.add(client);
          client.once("close", () => run.clients.delete(client));
          const task = this.handleClient(run, client, binding).catch(error => {
            this.log("stderr", `Connection failed: ${errorMessage(error)}`);
            client.destroy();
          }).finally(() => { run.tasks.delete(task); });
          run.tasks.add(task);
        };
        const server = binding.kind === "sslRelay"
          ? createTlsServer({ ...localTls!, minVersion: "TLSv1.2", allowHalfOpen: true, handshakeTimeout: 10000 }, accept)
          : createServer({ pauseOnConnect: true, allowHalfOpen: true }, accept);
        run.servers.add(server);
        // TLS clients are tracked before their handshake so Stop can close them too.
        if (binding.kind === "sslRelay") {
          server.on("connection", (client: Socket) => {
            if (run.stopping || run.pendingTls.size >= 256) { client.destroy(); return; }
            run.pendingTls.add(client);
            client.once("close", () => run.pendingTls.delete(client));
            client.on("error", () => {});
          });
          server.on("tlsClientError", error => this.log("stderr", `Local TLS handshake failed: ${errorMessage(error)}`));
        }
        const listener = endpoint(binding.bind);
        const bindingReady = new Promise<void>((resolve, reject) => {
          const onError = (error: Error): void => { server.off("listening", onListening); reject(error); };
          const onListening = (): void => {
            server.off("error", onError);
            if (run.stopping || this.run !== run) {
              server.close(() => reject(new Error("Relay startup was cancelled.")));
            } else resolve();
          };
          server.once("error", onError);
          server.once("listening", onListening);
          server.listen(listener.port, listener.host);
        });
        run.binds.add(bindingReady);
        try { await bindingReady; } finally { run.binds.delete(bindingReady); }
        server.on("error", error => {
          this.log("stderr", `Listener ${binding.bind} failed: ${errorMessage(error)}`);
        });
        this.state.listeners.push(binding.bind);
      }
      if (run.stopping || this.run !== run) throw new Error("Relay startup was cancelled.");
      this.state.status = "running";
      this.state.startedAt = new Date().toISOString();
      this.log("app", `Relay running with ${run.servers.size} listening ${run.servers.size === 1 ? "binding" : "bindings"}.`);
      return this.snapshot();
    } catch (error) {
      const cancelled = run.stopping;
      await this.cleanup(run);
      if (this.run === run) {
        this.run = null;
        this.state.status = cancelled ? "stopped" : "failed";
        this.state.error = cancelled ? null : this.clean(errorMessage(error));
        this.state.listeners = [];
        if (!cancelled) this.log("stderr", `Cannot start relay: ${errorMessage(error)}`);
        this.secrets = [];
      }
      throw new Error(this.state.error ?? "Relay startup was cancelled.");
    }
  }

  private async handleClient(run: Run, client: Socket, binding: RelayBinding): Promise<void> {
    const abort = new AbortController();
    let session: NativeSession | null = null;
    const onClose = (): void => {
      abort.abort();
      if (session) {
        session.output.destroy();
        void session.close().catch(error => this.log("stderr", errorMessage(error)));
      }
    };
    const onError = (error: Error): void => {
      this.log("stderr", `Local connection failed: ${errorMessage(error)}`);
      client.destroy();
    };
    client.once("close", onClose);
    client.on("error", onError);
    try {
      const destination = binding.kind === "socks5" ? await negotiateSocks5(client) : endpoint(binding.target);
      if (run.stopping || client.destroyed) return;
      session = await run.connector.connect(destination.host, destination.port, abort.signal);
      if (run.stopping || client.destroyed) { await session.close(); return; }
      run.sessions.add(session);
      const current = session;
      current.input.on("error", error => {
        if (!run.stopping && !client.destroyed) this.log("stderr", `Upstream write failed: ${errorMessage(error)}`);
        client.destroy();
      });
      current.output.on("error", error => {
        if (!run.stopping && !client.destroyed) this.log("stderr", `Upstream read failed: ${errorMessage(error)}`);
        client.destroy();
      });
      if (binding.kind === "socks5") client.write(socks5Reply(0));
      this.log("app", `Connected ${binding.bind} → ${destination.host}:${destination.port}`);
      const outputDone = finished(current.output, { readable: true, writable: false, cleanup: true });
      client.pipe(current.input);
      current.output.pipe(client);
      // Native TCP close can precede draining plaintext already buffered in the
      // readable stream. Let pipe end the client after those bytes are written.
      await Promise.all([current.closed, outputDone]);
    } catch (error) {
      if (!run.stopping && !client.destroyed) {
        this.log("stderr", `Relay connection failed: ${errorMessage(error)}`);
        if (binding.kind === "socks5" && !session) {
          const code = (error as NodeJS.ErrnoException).code;
          const reply = error instanceof Socks5Error ? error.replyCode
            : code === "ECONNREFUSED" ? 5 : code === "ENETUNREACH" ? 3 : code === "ENOTFOUND" ? 4 : 1;
          if (reply !== undefined && !client.writableEnded) client.end(socks5Reply(reply));
          else if (!client.writableEnded) client.end();
        } else client.destroy();
      }
    } finally {
      if (session) run.sessions.delete(session);
    }
  }

  private cleanup(run: Run): Promise<void> {
    if (run.cleanup) return run.cleanup;
    run.stopping = true;
    run.cleanup = (async () => {
      for (const client of run.clients) client.destroy();
      for (const client of run.pendingTls) client.destroy();
      // Pending listen calls finish by closing themselves once stopping is set.
      // Closing them earlier can suppress their listening event and strand startup.
      await Promise.allSettled([...run.binds]);
      const servers = [...run.servers].map(server => new Promise<void>(resolve => {
        if (!server.listening) { resolve(); return; }
        server.close(() => resolve());
      }));
      await Promise.allSettled([
        ...servers,
        ...[...run.sessions].map(session => session.close()),
        run.connector.close(),
      ]);
      await Promise.allSettled([...run.tasks]);
      run.clients.clear();
      run.pendingTls.clear();
      run.sessions.clear();
      run.servers.clear();
    })();
    return run.cleanup;
  }

  async stop(): Promise<RelayState> {
    const run = this.run;
    if (!run) return this.snapshot();
    this.state.status = "stopping";
    await this.cleanup(run);
    if (this.run === run) {
      this.run = null;
      this.state.status = "stopped";
      this.state.startedAt = null;
      this.state.listeners = [];
      this.state.error = null;
      this.log("app", "Relay stopped; listeners and connections closed.");
      this.secrets = [];
    }
    return this.snapshot();
  }
}
