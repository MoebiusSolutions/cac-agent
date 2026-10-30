import { isIP, type Socket } from "node:net";

export interface Destination { host: string; port: number }

export class Socks5Error extends Error {
  constructor(message: string, readonly replyCode?: number) { super(message); }
}

/** A bounded reader that preserves application bytes sent with the SOCKS request. */
class HandshakeReader {
  private bytes: Buffer = Buffer.alloc(0);
  private failure: Error | null = null;
  private wake: (() => void) | null = null;
  private timer: ReturnType<typeof setTimeout>;

  constructor(private readonly socket: Socket, timeoutMs: number) {
    this.timer = setTimeout(() => this.fail(new Socks5Error("SOCKS5 negotiation timed out.", 1)), timeoutMs);
    socket.on("data", this.onData);
    socket.on("error", this.onError);
    socket.on("end", this.onEnd);
    socket.on("close", this.onEnd);
    socket.resume();
  }

  private fail(error: Error): void {
    this.failure ??= error;
    this.wake?.();
  }

  private onData = (chunk: Buffer): void => {
    if (this.bytes.length + chunk.length > 65536) {
      this.fail(new Socks5Error("SOCKS5 negotiation exceeded its buffer limit.", 1));
      this.socket.pause();
      return;
    }
    this.bytes = Buffer.concat([this.bytes, chunk]);
    this.wake?.();
  };
  private onError = (error: Error): void => { this.fail(error); };
  private onEnd = (): void => { this.fail(new Socks5Error("SOCKS5 client disconnected during negotiation.")); };

  async read(length: number): Promise<Buffer> {
    while (this.bytes.length < length) {
      if (this.failure) throw this.failure;
      await new Promise<void>(resolve => { this.wake = resolve; });
      this.wake = null;
    }
    if (this.failure) throw this.failure;
    const result = this.bytes.subarray(0, length);
    this.bytes = this.bytes.subarray(length);
    return result;
  }

  release(preserveBytes: boolean): void {
    clearTimeout(this.timer);
    this.socket.pause();
    this.socket.off("data", this.onData);
    this.socket.off("error", this.onError);
    this.socket.off("end", this.onEnd);
    this.socket.off("close", this.onEnd);
    if (preserveBytes && this.bytes.length && !this.socket.destroyed) this.socket.unshift(this.bytes);
    this.bytes = Buffer.alloc(0);
  }
}

/** RFC 1928 CONNECT with no authentication; TLS is added by the relay upstream. */
export async function negotiateSocks5(socket: Socket, timeoutMs = 10000): Promise<Destination> {
  const reader = new HandshakeReader(socket, timeoutMs);
  let completed = false;
  try {
    const greeting = await reader.read(2);
    if (greeting[0] !== 5 || greeting[1] === 0) throw new Socks5Error("Invalid SOCKS5 greeting.");
    const methods = await reader.read(greeting[1]!);
    if (!methods.includes(0)) {
      socket.end(Buffer.from([5, 255]));
      throw new Socks5Error("SOCKS5 client did not offer the no-authentication method.");
    }
    socket.write(Buffer.from([5, 0]));

    const request = await reader.read(4);
    if (request[0] !== 5 || request[2] !== 0) throw new Socks5Error("Invalid SOCKS5 request.", 1);
    if (request[1] !== 1) throw new Socks5Error("SOCKS5 supports CONNECT requests only.", 7);
    let host: string;
    if (request[3] === 1) {
      host = [...await reader.read(4)].join(".");
    } else if (request[3] === 3) {
      const length = (await reader.read(1))[0]!;
      if (!length) throw new Socks5Error("SOCKS5 destination hostname is empty.", 4);
      const bytes = await reader.read(length);
      // DNS names must not contain control characters, paths, or option-like input.
      host = bytes.toString("ascii");
      if ([...bytes].some(byte => byte > 127) || !/^[a-zA-Z0-9](?:[a-zA-Z0-9.-]*[a-zA-Z0-9.])?$/.test(host)) {
        throw new Socks5Error("SOCKS5 destination hostname is invalid.", 4);
      }
    } else if (request[3] === 4) {
      const bytes = await reader.read(16);
      host = Array.from({ length: 8 }, (_, index) => bytes.readUInt16BE(index * 2).toString(16)).join(":");
      if (isIP(host) !== 6) throw new Socks5Error("SOCKS5 destination IPv6 address is invalid.", 4);
    } else {
      throw new Socks5Error("SOCKS5 destination address type is unsupported.", 8);
    }
    const port = (await reader.read(2)).readUInt16BE(0);
    if (!port) throw new Socks5Error("SOCKS5 destination port must be nonzero.", 4);
    completed = true;
    return { host, port };
  } finally {
    reader.release(completed);
  }
}

export function socks5Reply(code: number): Buffer {
  return Buffer.from([5, code, 0, 1, 0, 0, 0, 0, 0, 0]);
}
