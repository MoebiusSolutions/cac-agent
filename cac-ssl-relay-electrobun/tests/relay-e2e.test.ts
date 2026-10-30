import { afterAll, afterEach, beforeAll, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { connect, createServer as createNetServer, type Server, type Socket } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { connect as connectTls, createServer as createTlsServer } from "node:tls";
import { RelayEngine } from "../src/bun/relay-engine";
import { defaultSettings } from "../src/bun/settings";
import type { Configuration, LaunchSettings, RelayKind } from "../src/shared/types";

let directory: string;
let settings: LaunchSettings;
let ca: Buffer;
let serverCertificate: Buffer;
let serverKey: Buffer;
const engines = new Set<RelayEngine>();
const servers = new Set<Server>();
const sockets = new Set<Socket>();

function openssl(args: string[]): void {
  const result = spawnSync("openssl", args, { cwd: directory, encoding: "utf8" });
  if (result.status !== 0) throw new Error(`Cannot generate end-to-end TLS fixtures: ${result.stderr}`);
}

beforeAll(async () => {
  directory = await mkdtemp(join(tmpdir(), "cac-relay-e2e-"));
  openssl(["req", "-x509", "-newkey", "rsa:2048", "-nodes", "-keyout", "ca.key", "-out", "ca.crt", "-days", "1", "-subj", "/CN=End-to-end Relay CA"]);
  for (const name of ["server", "client"]) {
    openssl(["req", "-new", "-newkey", "rsa:2048", ...(name === "client" ? ["-passout", "pass:e2e-key-passphrase"] : ["-nodes"]), "-keyout", `${name}.key`, "-out", `${name}.csr`, "-subj", `/CN=e2e-${name}`]);
    await writeFile(join(directory, `${name}.ext`), [
      "basicConstraints=critical,CA:FALSE", "keyUsage=critical,digitalSignature,keyEncipherment",
      `extendedKeyUsage=${name === "client" ? "clientAuth" : "serverAuth"}`,
      ...(name === "server" ? ["subjectAltName=DNS:localhost,IP:127.0.0.1"] : []), "",
    ].join("\n"));
    openssl(["x509", "-req", "-in", `${name}.csr`, "-CA", "ca.crt", "-CAkey", "ca.key", "-CAcreateserial", "-out", `${name}.crt`, "-days", "1", "-extfile", `${name}.ext`]);
  }
  [ca, serverCertificate, serverKey] = await Promise.all(["ca.crt", "server.crt", "server.key"].map(name => readFile(join(directory, name)))) as [Buffer, Buffer, Buffer];
  settings = {
    ...defaultSettings(), configDirectory: directory, identityMode: "pem",
    certificate: join(directory, "client.crt"), privateKey: join(directory, "client.key"), caFile: join(directory, "ca.crt"),
    localCertificatePath: join(directory, "server.crt"), localKeyPath: join(directory, "server.key"),
  };
});

afterEach(async () => {
  for (const socket of sockets) socket.destroy();
  sockets.clear();
  await Promise.all([...engines].map(engine => engine.stop())); engines.clear();
  await Promise.all([...servers].map(server => new Promise<void>(resolve => server.close(() => resolve())))); servers.clear();
});
afterAll(async () => { await rm(directory, { recursive: true, force: true }); });

function track(socket: Socket): void {
  sockets.add(socket);
  socket.once("close", () => sockets.delete(socket));
  socket.on("error", () => {});
}

async function listen(server: Server, port = 0): Promise<number> {
  servers.add(server);
  server.on("connection", track);
  await new Promise<void>((resolve, reject) => { server.once("error", reject); server.listen(port, "127.0.0.1", resolve); });
  return (server.address() as { port: number }).port;
}

async function freePort(): Promise<number> {
  const reservation = createNetServer();
  const port = await listen(reservation);
  await new Promise<void>(resolve => reservation.close(() => resolve()));
  servers.delete(reservation);
  return port;
}

async function waitFor(check: () => boolean): Promise<void> {
  const deadline = Date.now() + 5000;
  while (!check()) {
    if (Date.now() > deadline) throw new Error("End-to-end relay test timed out");
    await Bun.sleep(5);
  }
}

for (const kind of ["relay", "sslRelay", "socks5"] as RelayKind[]) {
  test(`complete ${kind} binding authenticates upstream mTLS and preserves binary data`, async () => {
    let peerAuthorized = false;
    let peerName = "";
    const upstream = createTlsServer({ cert: serverCertificate, key: serverKey, ca, requestCert: true, rejectUnauthorized: true, allowHalfOpen: true });
    upstream.on("tlsClientError", () => {});
    upstream.on("secureConnection", socket => {
      peerAuthorized = socket.authorized;
      peerName = socket.getPeerCertificate().subject.CN as string;
      const chunks: Buffer[] = [];
      socket.on("data", bytes => chunks.push(Buffer.from(bytes)));
      socket.on("end", () => socket.end(Buffer.concat(chunks)));
    });
    const upstreamPort = await listen(upstream);
    const localPort = await freePort();
    const configuration: Configuration = {
      directory, exists: true, revision: "e2e", useTty: false,
      bindings: [{ kind, name: kind === "socks5" ? "test" : "", bind: `127.0.0.1:${localPort}`, target: kind === "socks5" ? "" : `127.0.0.1:${upstreamPort}` }],
    };
    const engine = new RelayEngine(); engines.add(engine);
    expect((await engine.start(settings, configuration, { pin: "e2e-key-passphrase", localKeyPassphrase: "" })).status).toBe("running");
    const client = kind === "sslRelay"
      ? connectTls({ host: "127.0.0.1", port: localPort, ca, servername: "localhost", rejectUnauthorized: true })
      : connect({ host: "127.0.0.1", port: localPort });
    track(client);
    const received: Buffer[] = [];
    let ended = false;
    let clientError: Error | null = null;
    client.on("data", bytes => received.push(Buffer.from(bytes)));
    client.on("end", () => { ended = true; });
    client.on("error", error => { clientError = error; ended = true; });
    if (kind === "socks5") {
      const port = Buffer.alloc(2); port.writeUInt16BE(upstreamPort);
      client.write(Buffer.concat([Buffer.from([5, 1, 0, 5, 1, 0, 1, 127, 0, 0, 1]), port]));
      await waitFor(() => Buffer.concat(received).length >= 12 || clientError !== null);
      expect(Buffer.concat(received).subarray(0, 2)).toEqual(Buffer.from([5, 0]));
      expect(Buffer.concat(received)[3]).toBe(0);
    }
    const payload = Buffer.alloc(256 * 1024);
    for (let i = 0; i < payload.length; i++) payload[i] = i % 251;
    client.end(payload);
    await waitFor(() => ended);
    if (clientError) throw clientError;
    const response = Buffer.concat(received);
    expect(kind === "socks5" ? response.subarray(12) : response).toEqual(payload);
    expect(peerAuthorized).toBe(true);
    expect(peerName).toBe("e2e-client");
    expect((await engine.stop()).connections).toBe(0);
    expect(engine.snapshot().listeners).toEqual([]);
    const rebound = createNetServer();
    expect(await listen(rebound, localPort)).toBe(localPort);
  }, 10000);
}
