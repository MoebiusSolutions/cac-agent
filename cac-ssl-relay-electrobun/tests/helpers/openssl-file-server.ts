import { spawn } from "node:child_process";
import { createServer } from "node:net";

/** An independent peer avoids Windows Bun's intermittent missing TLS alert. */
export async function startOpenSSLFileServer(directory: string) {
  const reservation = createServer();
  await new Promise<void>(resolve => reservation.listen(0, "127.0.0.1", resolve));
  const port = (reservation.address() as { port: number }).port;
  await new Promise<void>(resolve => reservation.close(() => resolve()));
  const executable = process.env.CAC_TEST_WINDOWS_OPENSSL ?? (process.platform === "win32" ? "C:\\Program Files\\Git\\usr\\bin\\openssl.exe" : "openssl");
  const peer = spawn(executable, [
    "s_server", "-accept", `127.0.0.1:${port}`, "-cert", "server.crt", "-key", "server.key", "-WWW", "-naccept", "1", "-tls1_3",
  ], { cwd: directory, stdio: ["ignore", "pipe", "pipe"] });
  async function close(): Promise<void> {
    if (!peer.pid) return;
    if (peer.exitCode === null && peer.signalCode === null) {
      const exited = new Promise<void>(resolve => peer.once("exit", () => resolve()));
      peer.kill(); await exited;
    }
  }
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await new Promise<void>((resolve, reject) => {
      let output = "";
      timer = setTimeout(() => reject(new Error("OpenSSL TLS fixture did not start listening.")), 10000);
      peer.stdout.on("data", data => { output = (output + String(data)).slice(-4096); if (output.includes("ACCEPT")) resolve(); });
      peer.once("error", reject);
      peer.once("exit", code => reject(new Error(`OpenSSL TLS fixture exited before listening (${code}).`)));
    });
  } catch (error) { await close(); throw error; }
  finally { clearTimeout(timer); }
  return { port, close };
}
