import { expect, test } from "bun:test";
import { dlopen, ptr } from "bun:ffi";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createServer } from "node:tls";
import type { Socket } from "node:net";
import { createNativeConnector } from "../src/bun/native-tls";
import { defaultSettings } from "../src/bun/settings";

// Explicit opt-in: this test initializes a fresh SOFTWARE token in its own temp directory.
const provider = process.env.CAC_TEST_PKCS11_PROVIDER;
const modulePath = process.env.CAC_TEST_PKCS11_MODULE;
const softhsm = process.env.CAC_TEST_SOFTHSM_UTIL;
const pkcs11Tool = process.env.CAC_TEST_PKCS11_TOOL;
const enabled = !!provider && !!modulePath && !!softhsm && !!pkcs11Tool && /softhsm/i.test(modulePath);

test.skipIf(!enabled)("authenticates two native TLS connections using a token-generated, non-exportable PKCS#11 key", async () => {
  const directory = await mkdtemp(join(tmpdir(), "cac-pkcs11-test-"));
  const originalConfig = process.env.SOFTHSM2_CONF;
  const tokenPin = "123456"; // Isolated test token only.
  const tokens = join(directory, "tokens");
  await mkdir(tokens);
  const configuration = join(directory, "softhsm2.conf");
  await writeFile(configuration, `directories.tokendir = ${tokens}\nobjectstore.backend = file\nlog.level = ERROR\n`);
  process.env.SOFTHSM2_CONF = configuration;
  // Bun's JS environment map does not update C getenv(), used by SoftHSM.
  const environment = dlopen(process.platform === "darwin" ? "/usr/lib/libSystem.B.dylib" : "libc.so.6", {
    setenv: { args: ["ptr", "ptr", "int"], returns: "int" },
    unsetenv: { args: ["ptr"], returns: "int" },
  });
  const environmentName = Buffer.from("SOFTHSM2_CONF\0");
  const nativeConfiguration = Buffer.from(`${configuration}\0`);
  if (environment.symbols.setenv(ptr(environmentName), ptr(nativeConfiguration), 1) !== 0) throw new Error("Cannot configure isolated native SoftHSM environment");
  const nativeConfig = join(directory, "openssl.cnf");
  const quoted = (value: string) => `"${value.replace(/[\\"$]/g, "\\$&")}"`;
  await writeFile(nativeConfig, `config_diagnostics=1\nopenssl_conf=initialization\n[initialization]\nproviders=providers\n[providers]\ndefault=defaults\npkcs11=smartcard\n[defaults]\nactivate=1\n[smartcard]\nmodule=${quoted(provider!)}\npkcs11-module-path=${quoted(modulePath!)}\nactivate=1\n`);
  const command = (args: string[], native = false) => {
    const env = { ...process.env };
    if (native) { env.OPENSSL_CONF = nativeConfig; env.CAC_TEST_TOKEN_PIN = tokenPin; }
    const result = Bun.spawnSync(args, { cwd: directory, env, stdout: "pipe", stderr: "pipe" });
    if (result.exitCode !== 0) throw new Error(`Test fixture command ${args[0]} failed: ${result.stderr.toString()}`);
    return result.stdout.toString();
  };
  const openssl = process.env.CAC_TEST_OPENSSL ?? "openssl";
  const tool = (...args: string[]) => command([pkcs11Tool!, "--module", modulePath!, "--token-label", "cac-relay-test", "--login", "--pin", tokenPin, ...args]);
  const keyUri = "pkcs11:token=cac-relay-test;id=%01;type=private";
  const certUri = "pkcs11:token=cac-relay-test;id=%01;type=cert";
  const sockets = new Set<Socket>();
  const server = createServer;
  let tlsServer: ReturnType<typeof server> | undefined;
  let connector: ReturnType<typeof createNativeConnector> | undefined;
  try {
    command([softhsm!, "--module", modulePath!, "--init-token", "--free", "--label", "cac-relay-test", "--so-pin", "87654321", "--pin", tokenPin]);
    const generated = tool("--keypairgen", "--key-type", "rsa:2048", "--id", "01", "--label", "cac-relay-client", "--usage-sign", "--sensitive");
    expect(generated).toContain("never extractable");
    command([openssl, "req", "-new", "-x509", "-newkey", "rsa:2048", "-nodes", "-days", "1", "-keyout", "ca.key", "-out", "ca.pem", "-subj", "/CN=CAC Relay Test CA"]);
    command([openssl, "req", "-new", "-newkey", "rsa:2048", "-nodes", "-keyout", "server.key", "-out", "server.csr", "-subj", "/CN=localhost"]);
    await writeFile(join(directory, "server.ext"), "subjectAltName=DNS:localhost,IP:127.0.0.1\nextendedKeyUsage=serverAuth\n");
    command([openssl, "x509", "-req", "-in", "server.csr", "-CA", "ca.pem", "-CAkey", "ca.key", "-CAcreateserial", "-days", "1", "-out", "server.pem", "-extfile", "server.ext"]);
    command([openssl, "req", "-new", "-key", keyUri, "-passin", "env:CAC_TEST_TOKEN_PIN", "-out", "client.csr", "-subj", "/CN=cac-relay-client"], true);
    await writeFile(join(directory, "client.ext"), "extendedKeyUsage=clientAuth\n");
    command([openssl, "x509", "-req", "-in", "client.csr", "-CA", "ca.pem", "-CAkey", "ca.key", "-CAcreateserial", "-days", "1", "-out", "client.pem", "-extfile", "client.ext"]);
    command([openssl, "x509", "-in", "client.pem", "-outform", "DER", "-out", "client.der"]);
    tool("--write-object", join(directory, "client.der"), "--type", "cert", "--id", "01", "--label", "cac-relay-client");
    let authenticated = 0;
    tlsServer = createServer({
      key: await readFile(join(directory, "server.key")), cert: await readFile(join(directory, "server.pem")),
      ca: await readFile(join(directory, "ca.pem")), requestCert: true, rejectUnauthorized: true, minVersion: "TLSv1.2",
    }, (socket) => {
      expect(socket.authorized).toBe(true);
      expect(socket.getPeerCertificate().subject.CN).toBe("cac-relay-client");
      authenticated++;
      socket.on("data", (bytes) => socket.end(Buffer.concat([Buffer.from("authenticated:"), Buffer.from(bytes)])));
    });
    tlsServer.on("connection", (socket) => { sockets.add(socket); socket.once("close", () => sockets.delete(socket)); });
    tlsServer.on("tlsClientError", () => {});
    await new Promise<void>((resolve, reject) => {
      tlsServer!.once("error", reject);
      tlsServer!.listen(0, "127.0.0.1", resolve);
    });
    const port = (tlsServer.address() as { port: number }).port;
    const log: string[] = [];
    connector = createNativeConnector({
      ...defaultSettings(), configDirectory: directory, identityMode: "pkcs11", providerPath: provider!, pkcs11ModulePath: modulePath!,
      privateKey: keyUri, certificate: certUri, caFile: join(directory, "ca.pem"),
    }, { pin: tokenPin, localKeyPassphrase: "" }, (_source, message) => log.push(message));
    await connector.validate();
    for (let i = 0; i < 2; i++) {
      const session = await connector.connect("127.0.0.1", port);
      session.input.write(Buffer.from(`request-${i}`));
      const received: Buffer[] = [];
      for await (const bytes of session.output) received.push(Buffer.from(bytes));
      await session.closed;
      expect(Buffer.concat(received).toString()).toBe(`authenticated:request-${i}`);
      await session.close();
    }
    expect(authenticated).toBe(2);
    expect(log.join("\n")).not.toContain(tokenPin);
  } finally {
    await connector?.close();
    for (const socket of sockets) socket.destroy();
    if (tlsServer) await new Promise<void>((resolve) => tlsServer!.close(() => resolve()));
    if (originalConfig === undefined) delete process.env.SOFTHSM2_CONF;
    else process.env.SOFTHSM2_CONF = originalConfig;
    if (originalConfig === undefined) environment.symbols.unsetenv(ptr(environmentName));
    else {
      const original = Buffer.from(`${originalConfig}\0`);
      environment.symbols.setenv(ptr(environmentName), ptr(original), 1);
    }
    environment.close();
    await rm(directory, { recursive: true, force: true });
  }
}, 30000);
