import { createHash, randomUUID } from "node:crypto";
import { open, readFile, mkdir, rename, unlink } from "node:fs/promises";
import { isIP } from "node:net";
import { join, resolve } from "node:path";
import type { Configuration, RelayBinding, RelayKind } from "../shared/types";

const FILE_NAME = "agent.properties";
const kinds = new Set<RelayKind>(["relay", "sslRelay", "socks5"]);
const saves = new Map<string, Promise<unknown>>();

interface PropertyLine {
  raw: string;
  key?: string;
  value?: string;
}

function directoryPath(directory: string): string {
  if (typeof directory !== "string" || !directory.trim() || directory.includes("\0")) {
    throw new Error("Choose a configuration directory.");
  }
  return resolve(directory);
}

function revision(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

async function readBytes(directory: string): Promise<{ bytes: Buffer; exists: boolean }> {
  try {
    return { bytes: await readFile(join(directory, FILE_NAME)), exists: true };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return { bytes: Buffer.alloc(0), exists: false };
    }
    throw error;
  }
}

function decodeEscapes(value: string, line: number): string {
  let result = "";
  for (let i = 0; i < value.length; i++) {
    let character = value[i]!;
    if (character !== "\\") {
      result += character;
      continue;
    }
    character = value[++i]!;
    if (character === "u") {
      const hex = value.slice(i + 1, i + 5);
      if (!/^[0-9a-fA-F]{4}$/.test(hex)) {
        throw new Error(`Invalid Unicode escape in agent.properties at line ${line}.`);
      }
      result += String.fromCharCode(Number.parseInt(hex, 16));
      i += 4;
    } else {
      result += ({ t: "\t", n: "\n", r: "\r", f: "\f" } as Record<string, string>)[character] ?? character;
    }
  }
  return result;
}

function continues(line: string): boolean {
  let count = 0;
  for (let i = line.length - 1; i >= 0 && line[i] === "\\"; i--) count++;
  return count % 2 === 1;
}

/** Keep natural lines verbatim so unrelated properties, comments, and line endings survive edits. */
function parseProperties(source: string): PropertyLine[] {
  const naturalLines = source.match(/[^\r\n]*(?:\r\n|\r|\n|$)/g)?.filter(Boolean) ?? [];
  const entries: PropertyLine[] = [];
  for (let i = 0; i < naturalLines.length; i++) {
    const lineNumber = i + 1;
    let raw = naturalLines[i]!;
    let logical = raw.replace(/(?:\r\n|\r|\n)$/, "").replace(/^[ \t\f]+/, "");
    if (!logical || logical[0] === "#" || logical[0] === "!") {
      entries.push({ raw });
      continue;
    }
    while (continues(logical)) {
      logical = logical.slice(0, -1);
      if (i + 1 >= naturalLines.length) break;
      const next = naturalLines[++i]!;
      raw += next;
      logical += next.replace(/(?:\r\n|\r|\n)$/, "").replace(/^[ \t\f]+/, "");
    }

    let keyEnd = 0;
    let escaped = false;
    for (; keyEnd < logical.length; keyEnd++) {
      const character = logical[keyEnd]!;
      if (!escaped && (character === "=" || character === ":" || /[ \t\f]/.test(character))) break;
      escaped = character === "\\" ? !escaped : false;
    }
    let valueStart = keyEnd;
    while (/[ \t\f]/.test(logical[valueStart] ?? "\0")) valueStart++;
    if (logical[valueStart] === "=" || logical[valueStart] === ":") valueStart++;
    while (/[ \t\f]/.test(logical[valueStart] ?? "\0")) valueStart++;
    entries.push({
      raw,
      key: decodeEscapes(logical.slice(0, keyEnd), lineNumber),
      value: decodeEscapes(logical.slice(valueStart), lineNumber),
    });
  }
  return entries;
}

function relayKind(key: string): RelayKind | undefined {
  const dot = key.indexOf(".");
  if (dot < 0) return undefined;
  const prefix = key.slice(0, dot);
  return kinds.has(prefix as RelayKind) ? prefix as RelayKind : undefined;
}

interface Endpoint { host: string; port: number }

function endpoint(value: string, field: string): Endpoint {
  if (typeof value !== "string" || /[\s\x00-\x1f\x7f/@?#\\]/.test(value)) {
    throw new Error(`${field} must be a host and port, such as localhost:9090.`);
  }
  const match = /^(?:\[([^\]]+)\]|([^:\[\]]+)):(\d+)$/.exec(value);
  if (!match) throw new Error(`${field} must include a host and port, such as localhost:9090.`);
  const host = match[1] ?? match[2]!;
  const port = Number(match[3]);
  if (!Number.isSafeInteger(port) || port < 1 || port > 65535) {
    throw new Error(`${field} port must be between 1 and 65535.`);
  }
  if (match[1]) {
    if (isIP(host) !== 6) throw new Error(`${field} has an invalid IPv6 address.`);
    return { host: new URL(`http://[${host}]:${port}`).hostname, port };
  }
  if (host.length > 253 || !host.replace(/\.$/, "").split(".").every(label =>
    /^[a-zA-Z0-9](?:[a-zA-Z0-9-]*[a-zA-Z0-9])?$/.test(label) && label.length <= 63,
  ) || (/^[\d.]+$/.test(host) && host.includes(".") && isIP(host) !== 4)) {
    throw new Error(`${field} has an invalid hostname or IP address.`);
  }
  return { host: host.toLowerCase().replace(/\.$/, ""), port };
}

export function validateBindings(bindings: RelayBinding[]): void {
  if (!Array.isArray(bindings)) throw new Error("Relay bindings must be a list.");
  const keys = new Set<string>();
  const listeners: Endpoint[] = [];
  for (let i = 0; i < bindings.length; i++) {
    const binding = bindings[i];
    const label = `Relay ${i + 1}`;
    if (!binding || !kinds.has(binding.kind)) throw new Error(`${label} has an invalid relay type.`);
    if (typeof binding.name !== "string" || typeof binding.target !== "string") {
      throw new Error(`${label} has invalid values.`);
    }
    const listener = endpoint(binding.bind, `${label} listener`);
    if (binding.kind === "socks5") {
      if (!binding.name.trim() || binding.name !== binding.name.trim() || /[\x00-\x1f\x7f]/.test(binding.name)) {
        throw new Error(`${label} needs a SOCKS5 name without surrounding spaces or control characters.`);
      }
      if (binding.target !== "") throw new Error(`${label} SOCKS5 target must be empty; the client selects the destination.`);
    } else {
      endpoint(binding.target, `${label} destination`);
    }
    const key = `${binding.kind}.${binding.kind === "socks5" ? binding.name : binding.bind}`;
    if (keys.has(key)) throw new Error(`${label} duplicates another relay property.`);
    keys.add(key);
    if (listeners.some(existing => existing.port === listener.port && (
      existing.host === listener.host ||
      existing.host === "0.0.0.0" || listener.host === "0.0.0.0" ||
      existing.host === "[::]" || listener.host === "[::]"
    ))) throw new Error(`${label} uses a listener address and port that overlap another relay.`);
    listeners.push(listener);
  }
}

function configuration(directory: string, bytes: Buffer, exists: boolean): Configuration {
  const entries = parseProperties(bytes.toString("latin1"));
  const bindings: RelayBinding[] = [];
  const seen = new Set<string>();
  let useTty = false;
  for (const entry of entries) {
    if (entry.key === undefined) continue;
    if (entry.key === "use.tty") useTty = entry.value!.toLowerCase() === "true";
    const kind = relayKind(entry.key);
    if (!kind) continue;
    if (seen.has(entry.key)) throw new Error("agent.properties contains duplicate relay property keys.");
    seen.add(entry.key);
    const suffix = entry.key.slice(kind.length + 1);
    bindings.push(kind === "socks5"
      ? { kind, name: suffix, bind: entry.value!, target: "" }
      : { kind, name: "", bind: suffix, target: entry.value! });
  }
  validateBindings(bindings);
  return { directory, exists, revision: revision(bytes), bindings, useTty };
}

export async function readConfiguration(directory: string): Promise<Configuration> {
  const normalized = directoryPath(directory);
  const { bytes, exists } = await readBytes(normalized);
  return configuration(normalized, bytes, exists);
}

function encodeProperty(value: string, isKey: boolean): string {
  let encoded = "";
  for (let i = 0; i < value.length; i++) {
    const character = value[i]!;
    const code = value.charCodeAt(i);
    if (character === "\\") encoded += "\\\\";
    else if (character === "\t") encoded += "\\t";
    else if (character === "\n") encoded += "\\n";
    else if (character === "\r") encoded += "\\r";
    else if (character === "\f") encoded += "\\f";
    else if ((isKey && /[ =:#!]/.test(character)) || (!isKey && i === 0 && character === " ")) encoded += `\\${character}`;
    else if (code < 0x20 || code > 0x7e) encoded += `\\u${code.toString(16).padStart(4, "0")}`;
    else encoded += character;
  }
  return encoded;
}

async function save(directory: string, expectedRevision: string, bindings: RelayBinding[]): Promise<Configuration> {
  const before = await readBytes(directory);
  if (typeof expectedRevision !== "string" || revision(before.bytes) !== expectedRevision) {
    throw new Error("agent.properties changed since it was loaded. Reload the configuration before saving.");
  }
  const original = before.bytes.toString("latin1");
  const entries = parseProperties(original);
  const newline = /\r\n|\r|\n/.exec(original)?.[0] ?? "\n";
  let output = entries.filter(entry => entry.key === undefined || !relayKind(entry.key)).map(entry => entry.raw).join("");
  if (bindings.length && output && !/[\r\n]$/.test(output)) output += newline;
  for (const binding of bindings) {
    const key = `${binding.kind}.${binding.kind === "socks5" ? binding.name : binding.bind}`;
    const value = binding.kind === "socks5" ? binding.bind : binding.target;
    output += `${encodeProperty(key, true)}=${encodeProperty(value, false)}${newline}`;
  }
  const bytes = Buffer.from(output, "latin1");
  const result = configuration(directory, bytes, true);
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const temporary = join(directory, `.${FILE_NAME}.${randomUUID()}.tmp`);
  try {
    const file = await open(temporary, "wx", 0o600);
    try {
      await file.writeFile(bytes);
      await file.sync();
    } finally {
      await file.close();
    }
    if (before.exists) {
      const backup = await open(join(directory, `${FILE_NAME}.backup-${Date.now()}-${randomUUID()}`), "wx", 0o600);
      try {
        await backup.writeFile(before.bytes);
        await backup.sync();
      } finally {
        await backup.close();
      }
    }
    const current = await readBytes(directory);
    if (current.exists !== before.exists || revision(current.bytes) !== expectedRevision) {
      throw new Error("agent.properties changed while saving. Reload the configuration before saving.");
    }
    await rename(temporary, join(directory, FILE_NAME));
    return result;
  } finally {
    await unlink(temporary).catch(error => {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    });
  }
}

/** Serialize competing saves in this process; external changes are checked again before replacement. */
export async function saveConfiguration(directory: string, expectedRevision: string, bindings: RelayBinding[]): Promise<Configuration> {
  const normalized = directoryPath(directory);
  validateBindings(bindings);
  const snapshot = bindings.map(binding => ({ ...binding }));
  const previous = saves.get(normalized) ?? Promise.resolve();
  const pending = previous.catch(() => {}).then(() => save(normalized, expectedRevision, snapshot));
  saves.set(normalized, pending);
  try {
    return await pending;
  } finally {
    if (saves.get(normalized) === pending) saves.delete(normalized);
  }
}
