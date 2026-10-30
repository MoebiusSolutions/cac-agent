import { afterEach, describe, expect, test } from "bun:test";
import { readFile, writeFile } from "node:fs/promises";
import { createServer as createNetServer, type Server, type Socket } from "node:net";
import { join } from "node:path";
import { createServer } from "node:tls";
import { createSchannelConnector } from "../src/bun/schannel-tls";
import type { NativeConnector } from "../src/bun/relay-engine";
import { defaultSettings } from "../src/bun/settings";
import { startOpenSSLFileServer } from "./helpers/openssl-file-server";

// The Windows harness owns one temporary software CNG certificate and deletes
// that exact identity/key afterward. Tests never access card PINs or Root stores.
const fixture = process.env.CAC_TEST_WINDOWS_TLS_DIRECTORY;
const certificateId = process.env.CAC_TEST_WINDOWS_CERTIFICATE_ID;
const enabled = process.platform === "win32" && !!fixture && !!certificateId;
const connectors = new Set<NativeConnector>();
const servers = new Set<Server>();
const sockets = new Set<Socket>();
const peers = new Set<Awaited<ReturnType<typeof startOpenSSLFileServer>>>();

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

function connector(caFile = join(fixture!, "ca.crt")): NativeConnector {
  const instance = createSchannelConnector({ ...defaultSettings(), identityMode: "ncrypt", windowsCertificateId: certificateId!, caFile },
    { pin: "", localKeyPassphrase: "" }, (_source, message) => { if (process.env.CAC_TEST_WINDOWS_TRACE) console.log(message); });
  connectors.add(instance);
  return instance;
}

async function listen(server: Server): Promise<number> {
  servers.add(server);
  server.on("connection", socket => { sockets.add(socket); socket.on("close", () => sockets.delete(socket)); });
  await new Promise<void>((resolve, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", resolve); });
  return (server.address() as { port: number }).port;
}

async function tlsServer(name = "server", requestCert = true, version?: "TLSv1.2" | "TLSv1.3") {
  const server = createServer({
    cert: await readFile(join(fixture!, `${name}.crt`)), key: await readFile(join(fixture!, `${name}.key`)),
    ca: await readFile(join(fixture!, "client.crt")), requestCert, rejectUnauthorized: true, allowHalfOpen: true,
    ...(version ? { minVersion: version, maxVersion: version } : {}),
  });
  server.on("tlsClientError", () => {});
  return server;
}

async function timeout<T>(promise: Promise<T>, ms = 10000): Promise<T> {
  let timer: ReturnType<typeof setTimeout>;
  try { return await Promise.race([promise, new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error("Schannel test timed out")), ms); })]); }
  finally { clearTimeout(timer!); }
}

describe.skipIf(!enabled)("Windows Schannel and CNG", () => {
  for (const version of ["TLSv1.2", "TLSv1.3"] as const) {
    test(`authenticates with the selected CNG certificate over ${version} and preserves a binary half-close`, async () => {
      const server = await tlsServer("server", true, version);
      let authorized = false;
      server.on("secureConnection", socket => {
        authorized = socket.authorized;
        const chunks: Buffer[] = [];
        socket.on("data", data => chunks.push(Buffer.from(data)));
        socket.on("end", () => socket.end(Buffer.concat(chunks)));
      });
      const native = connector();
      await native.validate();
      const port = await listen(server);
      for (let iteration = 0; iteration < 2; iteration++) {
        const session = await timeout(native.connect("localhost", port));
        const payload = Buffer.alloc(1024 * 1024);
        for (let index = 0; index < payload.length; index++) payload[index] = (index + iteration) % 251;
        const response = (async () => { const chunks: Buffer[] = []; for await (const data of session.output) chunks.push(Buffer.from(data)); return Buffer.concat(chunks); })();
        session.input.end(payload);
        expect(await timeout(response)).toEqual(payload);
        expect(authorized).toBe(true);
        await timeout(session.closed);
      }
    }, 30000);
  }

  test("shares the selected CNG identity across concurrent client-authentication handshakes", async () => {
    const server = await tlsServer();
    server.on("secureConnection", socket => {
      socket.on("data", data => socket.write(data));
      socket.on("end", () => socket.end());
    });
    const port = await listen(server);
    const native = connector();
    await timeout(Promise.all(Array.from({ length: 6 }, async (_, index) => {
      const session = await native.connect("localhost", port);
      const payload = Buffer.alloc(128 * 1024, 41 + index);
      const response = (async () => { const chunks: Buffer[] = []; for await (const data of session.output) chunks.push(Buffer.from(data)); return Buffer.concat(chunks); })();
      session.input.end(payload);
      expect(await response).toEqual(payload);
      await session.closed;
    })));
  });

  test("rejects the wrong hostname and untrusted chain before any application data", async () => {
    const wrong = await tlsServer("wrong-host", true);
    let received = 0;
    wrong.on("secureConnection", socket => socket.on("data", data => { received += data.length; }));
    const native = connector();
    await expect(timeout(native.connect("127.0.0.1", await listen(wrong)))).rejects.toThrow("verification failed");
    expect(received).toBe(0);
    expect(native.getIdentityError?.()).toBe(null);
    const valid = await tlsServer("server", true);
    let authorized = false;
    valid.on("secureConnection", socket => {
      authorized = socket.authorized;
      socket.on("data", data => { received += data.length; });
      socket.end("verified-server");
    });
    const port = await listen(valid);
    const untrusted = connector("");
    await expect(timeout(untrusted.connect("127.0.0.1", port))).rejects.toThrow("verification failed");
    const wrongBundle = connector(join(fixture!, "client.crt"));
    await expect(timeout(wrongBundle.connect("127.0.0.1", port))).rejects.toThrow("verification failed");
    expect(received).toBe(0);
    expect(wrongBundle.getIdentityError?.()).toBe(null);
    const verified = await timeout(native.connect("127.0.0.1", port));
    const chunks: Buffer[] = [];
    for await (const data of verified.output) chunks.push(Buffer.from(data));
    expect(Buffer.concat(chunks).toString()).toBe("verified-server");
    expect(authorized).toBe(true);
    await timeout(verified.closed);
    expect(native.getIdentityError?.()).toBe(null);
  });

  test("drains a large final response after backpressure", async () => {
    const payload = Buffer.alloc(4 * 1024 * 1024, 67);
    await writeFile(join(fixture!, "large.txt"), payload);
    const peer = await startOpenSSLFileServer(fixture!); peers.add(peer);
    const session = await timeout(connector().connect("127.0.0.1", peer.port));
    session.input.end("GET /large.txt HTTP/1.0\r\n\r\n");
    await Bun.sleep(50);
    const response = (async () => {
      const chunks: Buffer[] = [];
      for await (const data of session.output) { chunks.push(Buffer.from(data)); await Bun.sleep(1); }
      return Buffer.concat(chunks);
    })();
    const received = await timeout(response);
    const body = received.indexOf("\r\n\r\n");
    expect(body).toBeGreaterThan(0);
    expect(received.subarray(body + 4)).toEqual(payload);
    await timeout(session.closed);
  });

  test("rejects abrupt TCP truncation without a TLS close notification", async () => {
    const server = await tlsServer("server", false);
    server.on("secureConnection", socket => { setTimeout(() => socket.destroy(), 20); });
    const session = await timeout(connector().connect("127.0.0.1", await listen(server)));
    await expect(timeout((async () => { for await (const _data of session.output) { /* drain */ } })())).rejects.toThrow("close notification");
    await timeout(session.closed);
  });

  test("cancels pending handshakes and stops live native sessions", async () => {
    const port = await listen(createNetServer());
    const native = connector();
    const abort = new AbortController();
    const connecting = native.connect("127.0.0.1", port, abort.signal);
    setTimeout(() => abort.abort(), 30);
    await expect(timeout(connecting)).rejects.toThrow("cancelled");
    const another = native.connect("127.0.0.1", port);
    void another.catch(() => {});
    await Bun.sleep(30);
    await timeout(native.close());
    await expect(another).rejects.toThrow("closed");
  });
});
