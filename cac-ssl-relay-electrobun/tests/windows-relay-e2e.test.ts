import { afterEach, beforeAll, describe, expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import { connect, createServer as createNetServer, type Server, type Socket } from "node:net";
import { join } from "node:path";
import { connect as connectTls, createServer as createTlsServer } from "node:tls";
import { RelayEngine } from "../src/bun/relay-engine";
import { defaultSettings } from "../src/bun/settings";
import type { Configuration, LaunchSettings, RelayKind } from "../src/shared/types";

const directory = process.env.CAC_TEST_WINDOWS_TLS_DIRECTORY;
const certificateId = process.env.CAC_TEST_WINDOWS_CERTIFICATE_ID;
const enabled = process.platform === "win32" && !!directory && !!certificateId;

describe.skipIf(!enabled)("complete Windows CNG relay bindings", () => {
  let settings: LaunchSettings;
  let serverCertificate: Buffer;
  let serverKey: Buffer;
  let clientCertificate: Buffer;
  let ca: Buffer;
  const engines = new Set<RelayEngine>();
  const servers = new Set<Server>();
  const sockets = new Set<Socket>();

  beforeAll(async () => {
    [serverCertificate, serverKey, clientCertificate, ca] = await Promise.all(
      ["server.crt", "server.key", "client.crt", "ca.crt"].map(name => readFile(join(directory!, name))),
    ) as [Buffer, Buffer, Buffer, Buffer];
    settings = {
      ...defaultSettings(), configDirectory: directory!, identityMode: "ncrypt", windowsCertificateId: certificateId!,
      // The actual default connector factory must route CNG to Schannel with no
      // configured OpenSSL libraries, PKCS#11 providers, or PEM client identity.
      sslLibraryPath: "", cryptoLibraryPath: "", providerPath: "", pkcs11ModulePath: "", certificate: "", privateKey: "",
      caFile: join(directory!, "ca.crt"), localCertificatePath: join(directory!, "server.crt"), localKeyPath: join(directory!, "server.key"),
    };
  });

  afterEach(async () => {
    for (const socket of sockets) socket.destroy();
    sockets.clear();
    await Promise.all([...engines].map(engine => engine.stop()));
    engines.clear();
    await Promise.all([...servers].map(server => new Promise<void>(resolve => server.close(() => resolve()))));
    servers.clear();
  });

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

  async function waitFor(check: () => boolean, engine: RelayEngine): Promise<void> {
    const deadline = Date.now() + 10000;
    while (!check()) {
      if (Date.now() > deadline) throw new Error(`Windows relay test timed out: ${engine.snapshot().logs.map(entry => entry.message).join("; ")}`);
      await Bun.sleep(5);
    }
  }

  for (const kind of ["relay", "sslRelay", "socks5"] as RelayKind[]) {
    test(`${kind} uses the selected CNG identity for upstream mTLS and preserves binary data`, async () => {
      let authorized = false;
      let peerThumbprint = "";
      const upstream = createTlsServer({
        cert: serverCertificate, key: serverKey, ca: clientCertificate,
        requestCert: true, rejectUnauthorized: true, allowHalfOpen: true,
      });
      upstream.on("tlsClientError", () => {});
      upstream.on("secureConnection", socket => {
        authorized = socket.authorized;
        peerThumbprint = socket.getPeerCertificate().fingerprint.replaceAll(":", "").toUpperCase();
        const chunks: Buffer[] = [];
        socket.on("data", bytes => chunks.push(Buffer.from(bytes)));
        socket.on("end", () => socket.end(Buffer.concat(chunks)));
      });
      const upstreamPort = await listen(upstream);
      const localPort = await freePort();
      const configuration: Configuration = {
        directory: directory!, exists: true, revision: "windows-cng-e2e", useTty: false,
        bindings: [{
          kind, name: kind === "socks5" ? "windows-cng" : "", bind: `127.0.0.1:${localPort}`,
          target: kind === "socks5" ? "" : `127.0.0.1:${upstreamPort}`,
        }],
      };
      // No injected connector: this covers the production mode dispatch.
      const engine = new RelayEngine();
      engines.add(engine);
      expect((await engine.start(settings, configuration, { pin: "", localKeyPassphrase: "" })).status).toBe("running");
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
        const port = Buffer.alloc(2);
        port.writeUInt16BE(upstreamPort);
        client.write(Buffer.concat([Buffer.from([5, 1, 0, 5, 1, 0, 1, 127, 0, 0, 1]), port]));
        await waitFor(() => Buffer.concat(received).length >= 12 || clientError !== null, engine);
        if (clientError) throw clientError;
        const negotiation = Buffer.concat(received);
        expect(negotiation.subarray(0, 2)).toEqual(Buffer.from([5, 0]));
        expect(negotiation[3]).toBe(0);
      }

      const payload = Buffer.alloc(256 * 1024);
      for (let index = 0; index < payload.length; index++) payload[index] = index % 251;
      client.end(payload);
      await waitFor(() => ended, engine);
      if (clientError) throw clientError;
      const response = Buffer.concat(received);
      expect(kind === "socks5" ? response.subarray(12) : response).toEqual(payload);
      expect(authorized).toBe(true);
      expect(peerThumbprint).toBe(certificateId!.toUpperCase());
      const stopped = await engine.stop();
      expect(stopped.status).toBe("stopped");
      expect(stopped.connections).toBe(0);
      expect(stopped.listeners).toEqual([]);
      expect(await listen(createNetServer(), localPort)).toBe(localPort);
    }, 20000);
  }
});
