import { afterEach, describe, expect, test } from "bun:test";
import { createServer, createConnection, type Server, type Socket } from "node:net";
import { PassThrough, Writable } from "node:stream";
import { RelayEngine, type ConnectorFactory, type NativeSession } from "../src/bun/relay-engine";
import type { Configuration, LaunchSettings, RelayBinding } from "../src/shared/types";

const engines: RelayEngine[] = [];
const clients: Socket[] = [];
const servers: Server[] = [];
const settings: LaunchSettings = {
  sslLibraryPath: "", cryptoLibraryPath: "", configDirectory: "/tmp", identityMode: "none", windowsCertificateId: "", providerPath: "", pkcs11ModulePath: "",
  certificate: "", privateKey: "", caFile: "", localCertificatePath: "", localKeyPath: "",
};
const secrets = { pin: "", localKeyPassphrase: "" };

afterEach(async () => {
  for (const client of clients.splice(0)) client.destroy();
  await Promise.all(engines.splice(0).map(engine => engine.stop()));
  await Promise.all(servers.splice(0).map(server => new Promise<void>(resolve => server.close(() => resolve()))));
});

async function listen(server: Server): Promise<number> {
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => { server.off("error", reject); resolve(); });
  });
  return (server.address() as { port: number }).port;
}

async function ports(count: number): Promise<number[]> {
  const reserved = Array.from({ length: count }, () => createServer());
  const result = await Promise.all(reserved.map(listen));
  await Promise.all(reserved.map(server => new Promise<void>(resolve => server.close(() => resolve()))));
  return result;
}

function configuration(bindings: RelayBinding[]): Configuration {
  return { directory: "/tmp", exists: true, revision: "fixture", bindings, useTty: true };
}

function binding(port: number, kind: RelayBinding["kind"] = "relay"): RelayBinding {
  return { kind, name: kind === "socks5" ? "proxy" : "", bind: `127.0.0.1:${port}`, target: kind === "socks5" ? "" : "protected.example:443" };
}

function echoFactory(destinations: { host: string; port: number }[] = []): ConnectorFactory {
  return () => {
    const sessions = new Set<NativeSession>();
    return {
      validate: async () => {},
      connect: async (host, port) => {
        destinations.push({ host, port });
        const stream = new PassThrough();
        const closed = new Promise<void>(resolve => stream.once("close", () => resolve()));
        const session: NativeSession = { input: stream, output: stream, closed, close: async () => { stream.destroy(); await closed; } };
        sessions.add(session);
        void closed.then(() => sessions.delete(session));
        return session;
      },
      close: async () => { await Promise.all([...sessions].map(session => session.close())); },
    };
  };
}

async function connect(port: number): Promise<Socket> {
  const socket = createConnection({ host: "127.0.0.1", port });
  clients.push(socket);
  await new Promise<void>((resolve, reject) => {
    socket.once("connect", resolve);
    socket.once("error", reject);
  });
  return socket;
}

class Reader {
  private bytes = Buffer.alloc(0);
  private error: Error | null = null;
  private wake: (() => void) | null = null;
  constructor(socket: Socket) {
    socket.on("data", bytes => { this.bytes = Buffer.concat([this.bytes, Buffer.from(bytes)]); this.wake?.(); });
    socket.on("error", error => { this.error = error; this.wake?.(); });
    socket.on("end", () => { this.error ??= new Error("Socket ended"); this.wake?.(); });
  }
  async read(length: number): Promise<Buffer> {
    const timer = setTimeout(() => { this.error = new Error("Read timed out"); this.wake?.(); }, 3000);
    try {
      while (this.bytes.length < length) {
        if (this.error) throw this.error;
        await new Promise<void>(resolve => { this.wake = resolve; });
      }
      const result = this.bytes.subarray(0, length);
      this.bytes = this.bytes.subarray(length);
      return result;
    } finally { clearTimeout(timer); this.wake = null; }
  }
}

async function waitFor(check: () => boolean): Promise<void> {
  const deadline = Date.now() + 3000;
  while (!check()) {
    if (Date.now() > deadline) throw new Error("Timed out");
    await Bun.sleep(5);
  }
}

describe("TypeScript relay listeners", () => {
  test("starts actual listeners, relays binary bytes, ignores legacy use.tty, stops and releases ports", async () => {
    const [port] = await ports(1);
    const destinations: { host: string; port: number }[] = [];
    const engine = new RelayEngine(echoFactory(destinations)); engines.push(engine);
    const state = await engine.start(settings, configuration([binding(port!)]), secrets);
    expect(state.status).toBe("running");
    expect(state.listeners).toEqual([`127.0.0.1:${port}`]);
    const client = await connect(port!);
    const reader = new Reader(client);
    const payload = Buffer.from([0, 1, 2, 10, 13, 255, 128]);
    client.write(payload);
    expect(await reader.read(payload.length)).toEqual(payload);
    expect(destinations).toEqual([{ host: "protected.example", port: 443 }]);
    expect(engine.snapshot().connections).toBe(1);
    expect((await engine.stop()).status).toBe("stopped");
    const server = createServer(); servers.push(server);
    await new Promise<void>((resolve, reject) => { server.once("error", reject); server.listen(port!, "127.0.0.1", resolve); });
  });

  test("rolls back every listener and closes the connector if any binding is occupied", async () => {
    const [freePort] = await ports(1);
    const occupied = createServer(); servers.push(occupied);
    const occupiedPort = await listen(occupied);
    let closed = false;
    const engine = new RelayEngine(() => ({ validate: async () => {}, connect: async () => { throw new Error("unused"); }, close: async () => { closed = true; } })); engines.push(engine);
    await expect(engine.start(settings, configuration([binding(freePort!), binding(occupiedPort)]), secrets)).rejects.toThrow();
    expect(engine.snapshot().status).toBe("failed");
    expect(engine.snapshot().listeners).toEqual([]);
    expect(engine.isActive()).toBe(false);
    expect(closed).toBe(true);
    const server = createServer(); servers.push(server);
    await new Promise<void>((resolve, reject) => { server.once("error", reject); server.listen(freePort!, "127.0.0.1", resolve); });
  });

  test("cancels pending native handshakes when the client disconnects or relay stops", async () => {
    const [port] = await ports(1);
    let pending = 0;
    let aborted = 0;
    const controllers = new Set<() => void>();
    const engine = new RelayEngine(() => ({
      validate: async () => {},
      connect: async (_host, _port, signal) => new Promise<NativeSession>((_resolve, reject) => {
        pending++;
        const cancel = (): void => { aborted++; pending--; controllers.delete(cancel); reject(new Error("cancelled")); };
        controllers.add(cancel);
        signal?.addEventListener("abort", cancel, { once: true });
      }),
      close: async () => { for (const cancel of [...controllers]) cancel(); },
    })); engines.push(engine);
    await engine.start(settings, configuration([binding(port!)]), secrets);
    const client = await connect(port!);
    await waitFor(() => pending === 1);
    client.resetAndDestroy();
    await waitFor(() => pending === 0);
    expect(aborted).toBe(1);
    await connect(port!);
    await waitFor(() => pending === 1);
    await engine.stop();
    expect(pending).toBe(0);
    expect(engine.snapshot().connections).toBe(0);
  });

  test("redacts session secrets and bounds logs", async () => {
    const [port] = await ports(1);
    let identityError: string | null = null;
    const engine = new RelayEngine((_settings, sessionSecrets, log) => ({
      validate: async () => { for (let i = 0; i < 650; i++) log("stderr", `native error ${i}: ${sessionSecrets.pin}`); },
      connect: async () => { throw new Error("unused"); }, close: async () => {},
      getIdentityError: () => identityError,
    })); engines.push(engine);
    await engine.start(settings, configuration([binding(port!)]), { pin: "session-secret", localKeyPassphrase: "" });
    expect(engine.snapshot().logs.length).toBe(500);
    expect(JSON.stringify(engine.snapshot())).not.toContain("session-secret");
    identityError = "Token rejected session-secret; restart required.";
    expect(engine.snapshot().error).toBe("Token rejected [redacted]; restart required.");
    expect(engine.clearLogs().logs).toEqual([]);
    expect(engine.snapshot().error).toContain("restart required");
    await engine.stop();
    expect(engine.snapshot().error).toBeNull();
  });

  test("drains buffered plaintext after native close even when the local reader is slow", async () => {
    const [port] = await ports(1);
    const payload = Buffer.alloc(1024 * 1024, 0x6b);
    const engine = new RelayEngine(() => ({
      validate: async () => {},
      connect: async () => {
        const output = new PassThrough({ highWaterMark: 1024 });
        output.on("error", () => {});
        output.write(payload.subarray(0, 256 * 1024));
        output.end(payload.subarray(256 * 1024));
        return {
          input: new Writable({ write: (_bytes, _encoding, callback) => callback() }),
          output,
          closed: Promise.resolve(),
          close: async () => { output.destroy(); },
        };
      }, close: async () => {},
    })); engines.push(engine);
    await engine.start(settings, configuration([binding(port!)]), secrets);
    const client = await connect(port!);
    client.pause();
    await Bun.sleep(20);
    const reader = new Reader(client);
    client.resume();
    expect(await reader.read(payload.length)).toEqual(payload);
  });

  test("stop cancels startup validation and failed initialization never exposes a PIN", async () => {
    const [port] = await ports(1);
    let rejectValidation!: (error: Error) => void;
    const engine = new RelayEngine(() => ({
      validate: async () => new Promise<void>((_resolve, reject) => { rejectValidation = reject; }),
      connect: async () => { throw new Error("unused"); },
      close: async () => { rejectValidation(new Error("Initialization cancelled")); },
    })); engines.push(engine);
    const starting = engine.start(settings, configuration([binding(port!)]), secrets);
    const outcome = starting.then(() => null, error => error);
    await engine.stop();
    expect(await outcome).toBeInstanceOf(Error);
    expect(engine.snapshot().status).toBe("stopped");
    expect(engine.isActive()).toBe(false);

    const invalid = new RelayEngine((_settings, secret) => ({
      validate: async () => { throw new Error(`Cannot unlock ${secret.pin}`); },
      connect: async () => { throw new Error("unused"); }, close: async () => {},
    })); engines.push(invalid);
    const error = await invalid.start(settings, configuration([binding(port!)]), { pin: "private-pin", localKeyPassphrase: "" }).catch(error => error as Error);
    expect(String(error)).not.toContain("private-pin");
    expect(JSON.stringify(invalid.snapshot())).not.toContain("private-pin");
    expect(invalid.snapshot().error).toContain("[redacted]");
  });
});

describe("SOCKS5 protocol", () => {
  test("accepts fragmented negotiation, retains DNS for SNI, and preserves coalesced application bytes", async () => {
    const [port] = await ports(1);
    const destinations: { host: string; port: number }[] = [];
    const engine = new RelayEngine(echoFactory(destinations)); engines.push(engine);
    await engine.start(settings, configuration([binding(port!, "socks5")]), secrets);
    const client = await connect(port!);
    const reader = new Reader(client);
    client.write(Buffer.from([5])); await Bun.sleep(5);
    client.write(Buffer.from([2, 2])); await Bun.sleep(5);
    client.write(Buffer.from([0]));
    expect(await reader.read(2)).toEqual(Buffer.from([5, 0]));
    const domain = Buffer.from("cac.example");
    client.write(Buffer.concat([Buffer.from([5, 1, 0, 3, domain.length]), domain.subarray(0, 3)]));
    await Bun.sleep(5);
    client.write(Buffer.concat([domain.subarray(3), Buffer.from([1, 187]), Buffer.from("GET /hello\r\n")]));
    expect((await reader.read(10))[1]).toBe(0);
    expect((await reader.read(12)).toString()).toBe("GET /hello\r\n");
    expect(destinations).toEqual([{ host: "cac.example", port: 443 }]);
  });

  test("supports IPv4 and IPv6 destinations and fails unsupported commands without connecting", async () => {
    const [port] = await ports(1);
    const destinations: { host: string; port: number }[] = [];
    const engine = new RelayEngine(echoFactory(destinations)); engines.push(engine);
    await engine.start(settings, configuration([binding(port!, "socks5")]), secrets);
    for (const [type, address, host] of [
      [1, Buffer.from([127, 0, 0, 1]), "127.0.0.1"],
      [4, Buffer.from("20010db8000000000000000000000001", "hex"), "2001:db8:0:0:0:0:0:1"],
    ] as const) {
      const client = await connect(port!); const reader = new Reader(client);
      client.write(Buffer.concat([Buffer.from([5, 1, 0, 5, 1, 0, type]), address, Buffer.from([0, 80])]));
      expect(await reader.read(2)).toEqual(Buffer.from([5, 0]));
      expect((await reader.read(10))[1]).toBe(0);
      expect(destinations.at(-1)).toEqual({ host, port: 80 });
      client.destroy();
    }
    const client = await connect(port!); const reader = new Reader(client);
    client.write(Buffer.from([5, 1, 0, 5, 3, 0, 1, 127, 0, 0, 1, 0, 80]));
    await reader.read(2);
    expect((await reader.read(10))[1]).toBe(7);
    expect(destinations.length).toBe(2);
  });

  test("rejects clients offering no supported authentication and reports TLS connection failures", async () => {
    const [port] = await ports(1);
    const engine = new RelayEngine(() => ({ validate: async () => {}, connect: async () => { throw new Error("certificate verification failed"); }, close: async () => {} })); engines.push(engine);
    await engine.start(settings, configuration([binding(port!, "socks5")]), secrets);
    const rejected = await connect(port!); const rejectedReader = new Reader(rejected);
    rejected.write(Buffer.from([5, 1, 2]));
    expect(await rejectedReader.read(2)).toEqual(Buffer.from([5, 255]));
    const client = await connect(port!); const reader = new Reader(client);
    client.write(Buffer.from([5, 1, 0, 5, 1, 0, 1, 127, 0, 0, 1, 1, 187]));
    await reader.read(2);
    expect((await reader.read(10))[1]).toBe(1);
    expect(engine.snapshot().logs.some(entry => entry.message.includes("certificate verification failed"))).toBe(true);
  });
});
