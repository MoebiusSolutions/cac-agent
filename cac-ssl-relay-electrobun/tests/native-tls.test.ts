import { afterAll, afterEach, beforeAll, describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createServer as createNetServer, type Server, type Socket } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createServer } from "node:tls";
import type { LaunchSettings } from "../src/shared/types";
import type { NativeConnector } from "../src/bun/relay-engine";
import { createNativeConnector } from "../src/bun/native-tls";
import { defaultSettings } from "../src/bun/settings";
import { startOpenSSLFileServer } from "./helpers/openssl-file-server";

let directory: string;
let defaults: LaunchSettings;
const connectors = new Set<NativeConnector>();
const servers = new Set<Server>();
const sockets = new Set<Socket>();
const peers = new Set<Awaited<ReturnType<typeof startOpenSSLFileServer>>>();

function openssl(args: string[]): void {
  const result = spawnSync("openssl", args, { cwd: directory, encoding: "utf8" });
  if (result.status !== 0) throw new Error(`Fixture certificate generation failed: ${result.stderr}`);
}

beforeAll(async () => {
  directory = await mkdtemp(join(tmpdir(), "cac-native-tls-test-"));
  openssl(["req", "-x509", "-newkey", "rsa:2048", "-nodes", "-keyout", "ca.key", "-out", "ca.crt", "-days", "1", "-subj", "/CN=Relay Test CA"]);
  for (const name of ["server", "client", "wrong-host"]) {
    openssl(["req", "-new", "-newkey", "rsa:2048", ...(name === "client" ? ["-passout", "pass:fixture-secret"] : ["-nodes"]), "-keyout", `${name}.key`, "-out", `${name}.csr`, "-subj", `/CN=${name}`]);
    await writeFile(join(directory, `${name}.ext`), `basicConstraints=critical,CA:FALSE\nkeyUsage=critical,digitalSignature,keyEncipherment\nextendedKeyUsage=${name === "client" ? "clientAuth" : "serverAuth"}\n${name === "client" ? "" : `subjectAltName=DNS:${name === "wrong-host" ? "incorrect.example" : "localhost"}${name === "server" ? ",IP:127.0.0.1" : ""}\n`}`);
    openssl(["x509", "-req", "-in", `${name}.csr`, "-CA", "ca.crt", "-CAkey", "ca.key", "-CAcreateserial", "-out", `${name}.crt`, "-days", "1", "-extfile", `${name}.ext`]);
  }
  defaults = { ...defaultSettings(), identityMode: "pem", certificate: join(directory, "client.crt"), privateKey: join(directory, "client.key"), caFile: join(directory, "ca.crt") };
});

afterEach(async () => {
  await Promise.all([...connectors].map(connector => connector.close()));
  connectors.clear();
  for (const socket of sockets) socket.destroy();
  sockets.clear();
  await Promise.all([...servers].map(server => new Promise<void>(resolve => server.close(() => resolve()))));
  servers.clear();
  await Promise.all([...peers].map(peer => peer.close()));
  peers.clear();
});
afterAll(async () => { await rm(directory, { recursive: true, force: true }); });

function connector(settings: LaunchSettings = defaults, pin = "fixture-secret"): NativeConnector {
  const instance = createNativeConnector(settings, { pin, localKeyPassphrase: "" }, () => {});
  connectors.add(instance);
  return instance;
}

async function listen(server: Server): Promise<number> {
  servers.add(server);
  server.on("connection", socket => { sockets.add(socket); socket.on("close", () => sockets.delete(socket)); });
  await new Promise<void>((resolve, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", resolve); });
  return (server.address() as { port: number }).port;
}

async function tlsServer(name = "server", requestCert = true) {
  const server = createServer({
    cert: await readFile(join(directory, `${name}.crt`)), key: await readFile(join(directory, `${name}.key`)),
    ca: await readFile(join(directory, "ca.crt")), requestCert, rejectUnauthorized: true, allowHalfOpen: true,
  });
  server.on("tlsClientError", () => {});
  return server;
}

async function timeout<T>(promise: Promise<T>, ms = 5000): Promise<T> {
  let timer: ReturnType<typeof setTimeout>;
  try { return await Promise.race([promise, new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error("Native TLS test timed out")), ms); })]); }
  finally { clearTimeout(timer!); }
}

describe("native OpenSSL TLS", () => {
  test("unlocks an encrypted PEM key, authenticates mTLS and preserves binary data after an input half-close", async () => {
    const server = await tlsServer();
    let authorized = false;
    server.on("secureConnection", socket => {
      authorized = socket.authorized;
      const chunks: Buffer[] = [];
      socket.on("data", data => chunks.push(Buffer.from(data)));
      socket.on("end", () => socket.end(Buffer.concat(chunks)));
    });
    const port = await listen(server);
    const native = connector();
    await native.validate();
    const session = await native.connect("localhost", port);
    const payload = Buffer.alloc(1024 * 1024);
    for (let i = 0; i < payload.length; i++) payload[i] = i % 251;
    const received = (async () => { const chunks: Buffer[] = []; for await (const data of session.output) chunks.push(Buffer.from(data)); return Buffer.concat(chunks); })();
    session.input.end(payload);
    expect(await timeout(received)).toEqual(payload);
    expect(authorized).toBe(true);
    await timeout(session.closed);
  });

  test("rejects hostname/IP mismatch before data and can subsequently connect to a verified server", async () => {
    const server = await tlsServer("wrong-host", false);
    let applicationBytes = 0;
    server.on("secureConnection", socket => socket.on("data", data => { applicationBytes += data.length; }));
    const port = await listen(server);
    const native = connector({ ...defaults, identityMode: "none", certificate: "", privateKey: "" });
    await expect(native.connect("127.0.0.1", port)).rejects.toThrow("verification failed");
    expect(applicationBytes).toBe(0);
    const trusted = await tlsServer("server", false);
    trusted.on("secureConnection", socket => socket.end("verified-server"));
    const verified = await native.connect("127.0.0.1", await listen(trusted));
    const received: Buffer[] = [];
    for await (const bytes of verified.output) received.push(Buffer.from(bytes));
    expect(Buffer.concat(received).toString()).toBe("verified-server");
    await timeout(verified.closed);
  });

  test("drains large final responses with a slow consumer before freeing native TLS state", async () => {
    const payload = Buffer.alloc(4 * 1024 * 1024, 93);
    let port: number;
    if (process.platform === "win32") {
      await writeFile(join(directory, "large.txt"), payload);
      const peer = await startOpenSSLFileServer(directory); peers.add(peer);
      port = peer.port;
    } else {
      const server = await tlsServer("server", false);
      server.on("secureConnection", socket => socket.end(payload));
      port = await listen(server);
    }
    const native = connector({ ...defaults, identityMode: "none", certificate: "", privateKey: "" });
    const session = await native.connect("127.0.0.1", port);
    if (process.platform === "win32") session.input.end("GET /large.txt HTTP/1.0\r\n\r\n");
    await Bun.sleep(50);
    const received = (async () => {
      const chunks: Buffer[] = [];
      for await (const bytes of session.output) { chunks.push(Buffer.from(bytes)); await Bun.sleep(1); }
      return Buffer.concat(chunks);
    })();
    const data = await timeout(received);
    if (process.platform === "win32") {
      const separator = data.indexOf("\r\n\r\n");
      expect(separator).toBeGreaterThan(0);
      expect(data.subarray(separator + 4)).toEqual(payload);
    } else expect(data).toEqual(payload);
    await timeout(session.closed);
  });

  test("rejects untrusted server chains and incorrect client-key passphrases", async () => {
    const server = await tlsServer("server", false);
    const port = await listen(server);
    const native = connector({ ...defaults, caFile: "", identityMode: "none", certificate: "", privateKey: "" });
    await expect(native.connect("127.0.0.1", port)).rejects.toThrow("verification failed");
    const invalid = connector(defaults, "incorrect-fixture-secret");
    await expect(invalid.validate()).rejects.toThrow("Cannot unlock");
  });

  test("cancels a pending handshake and connector close releases live native sessions", async () => {
    const port = await listen(createNetServer());
    const native = connector({ ...defaults, identityMode: "none", certificate: "", privateKey: "" });
    const abort = new AbortController();
    const pending = native.connect("127.0.0.1", port, abort.signal);
    setTimeout(() => abort.abort(), 30);
    await expect(timeout(pending)).rejects.toThrow("cancelled");
    const another = native.connect("127.0.0.1", port);
    void another.catch(() => {});
    await Bun.sleep(30);
    await timeout(native.close());
    await expect(another).rejects.toThrow("closed");
  });
});
