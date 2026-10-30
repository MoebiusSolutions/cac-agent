import { afterEach, describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { chmod, mkdtemp, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readConfiguration, saveConfiguration, validateBindings } from "../src/bun/configuration";
import type { RelayBinding } from "../src/shared/types";

const directories: string[] = [];
async function temporaryDirectory(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), "cac-relay-config-test-"));
  directories.push(directory);
  return directory;
}

afterEach(async () => {
  await Promise.all(directories.splice(0).map(directory => rm(directory, { recursive: true, force: true })));
});

const relay = (bind = "127.0.0.1:9090", target = "protected.example:443"): RelayBinding => ({
  kind: "relay", name: "", bind, target,
});

describe("Java properties compatibility", () => {
  test("reads ISO-8859-1, escaped key separators, Unicode, continuations, and all binding kinds", async () => {
    const directory = await temporaryDirectory();
    const original = Buffer.from(
      "! An unrelated comment\\\r\n" +
      "user=jalape\u00f1o\r\n" +
      "pass = do\\=not\\:touch\r\n" +
      "relay.127.0.0.1\\:9090=protected.\\\r\n    example:443\r\n" +
      "sslRelay.localhost\\u003a9443 : secure.example\\:443\r\n" +
      "socks5.team\\ name=127.0.0.1:9080\r\n" +
      "use.tty=TRUE\r\n", "latin1",
    );
    await writeFile(join(directory, "agent.properties"), original);
    const config = await readConfiguration(directory);
    expect(config.exists).toBe(true);
    expect(config.useTty).toBe(true);
    expect(config.bindings).toEqual([
      relay(),
      { kind: "sslRelay", name: "", bind: "localhost:9443", target: "secure.example:443" },
      { kind: "socks5", name: "team name", bind: "127.0.0.1:9080", target: "" },
    ]);
    expect(config.revision).toBe(createHash("sha256").update(original).digest("hex"));
  });

  test("reports duplicate decoded keys, listener collisions, and malformed escapes", async () => {
    const directory = await temporaryDirectory();
    const path = join(directory, "agent.properties");
    await writeFile(path, "relay.localhost\\:9090=a.example:443\nrelay.localhost\\u003a9090=b.example:443\n");
    await expect(readConfiguration(directory)).rejects.toThrow("duplicate relay property");
    await writeFile(path, "relay.localhost\\:9090=a.example:443\nsslRelay.LOCALHOST\\:9090=b.example:443\n");
    await expect(readConfiguration(directory)).rejects.toThrow("overlap");
    await writeFile(path, "unrelated=\\uNOTHEX\n");
    await expect(readConfiguration(directory)).rejects.toThrow("Invalid Unicode escape");
  });

  test("matches Java use.tty last-property and trailing whitespace semantics", async () => {
    const directory = await temporaryDirectory();
    const path = join(directory, "agent.properties");
    await writeFile(path, "use.tty=true\nuse\\u002etty=false\n");
    expect((await readConfiguration(directory)).useTty).toBe(false);
    await writeFile(path, "use.tty=true \n");
    expect((await readConfiguration(directory)).useTty).toBe(false);
  });
});

describe("safe configuration edits", () => {
  test("preserves unrelated bytes and comments, backs up original bytes, and writes private atomic files", async () => {
    const directory = await temporaryDirectory();
    const path = join(directory, "agent.properties");
    const kept = "# Identity settings\r\nuser=jalape\u00f1o\r\npass=keep\\\r\n  exactly\\=this\r\nmaster=private value  \r\nrelayX=unrelated property\r\n";
    const original = Buffer.from(kept + "# Relay settings\r\nrelay.localhost\\:9090=old.example:443\r\n! End\r\n", "latin1");
    await writeFile(path, original);
    await chmod(path, 0o644);
    const before = await readConfiguration(directory);
    const replacement: RelayBinding[] = [
      relay("127.0.0.1:8080"),
      { kind: "socks5", name: "caf\u00e9 proxy", bind: "localhost:9080", target: "" },
    ];
    const saved = await saveConfiguration(directory, before.revision, replacement);
    expect(saved.bindings).toEqual(replacement);
    const output = await readFile(path);
    expect(output.toString("latin1")).toBe(kept + "# Relay settings\r\n! End\r\n" +
      "relay.127.0.0.1\\:8080=protected.example:443\r\n" +
      "socks5.caf\\u00e9\\ proxy=localhost:9080\r\n");
    const backups = (await readdir(directory)).filter(name => name.startsWith("agent.properties.backup-"));
    expect(backups).toHaveLength(1);
    expect(await readFile(join(directory, backups[0]!))).toEqual(original);
    if (process.platform !== "win32") {
      expect((await stat(path)).mode & 0o777).toBe(0o600);
      expect((await stat(join(directory, backups[0]!))).mode & 0o777).toBe(0o600);
    }
    expect((await readdir(directory)).some(name => name.endsWith(".tmp"))).toBe(false);
    expect(await readConfiguration(directory)).toEqual(saved);
  });

  test("creates missing configuration only when explicitly saved", async () => {
    const parent = await temporaryDirectory();
    const directory = join(parent, "new-profile");
    const before = await readConfiguration(directory);
    expect(before.exists).toBe(false);
    expect(before.bindings).toEqual([]);
    expect(before.revision).toBe(createHash("sha256").update("").digest("hex"));
    expect(await readdir(parent)).toEqual([]);
    const result = await saveConfiguration(directory, before.revision, [relay()]);
    expect(result.exists).toBe(true);
    expect((await readConfiguration(directory)).bindings).toEqual([relay()]);
    expect((await readdir(directory)).filter(name => name.includes("backup"))).toEqual([]);
  });

  test("does not overwrite external edits or create backups on a stale revision", async () => {
    const directory = await temporaryDirectory();
    const path = join(directory, "agent.properties");
    await writeFile(path, "user=first\n");
    const before = await readConfiguration(directory);
    const external = "user=second\npass=external-secret\n";
    await writeFile(path, external);
    await expect(saveConfiguration(directory, before.revision, [relay()])).rejects.toThrow("changed since it was loaded");
    expect(await readFile(path, "utf8")).toBe(external);
    expect(await readdir(directory)).toEqual(["agent.properties"]);
  });

  test("serializes simultaneous saves and rejects the second stale update", async () => {
    const directory = await temporaryDirectory();
    const before = await readConfiguration(directory);
    const results = await Promise.allSettled([
      saveConfiguration(directory, before.revision, [relay("localhost:8080")]),
      saveConfiguration(directory, before.revision, [relay("localhost:8081")]),
    ]);
    expect(results[0]!.status).toBe("fulfilled");
    expect(results[1]!.status).toBe("rejected");
    expect((await readConfiguration(directory)).bindings).toEqual([relay("localhost:8080")]);
  });

  test("removes every old binding while retaining unrelated properties when saving an empty list", async () => {
    const directory = await temporaryDirectory();
    const path = join(directory, "agent.properties");
    await writeFile(path, "relay.localhost\\:9090=a.example:443\nsocks5.proxy=localhost:9080\nuse.tty=true\n# Stay here");
    const before = await readConfiguration(directory);
    const saved = await saveConfiguration(directory, before.revision, []);
    expect(saved.bindings).toEqual([]);
    expect(saved.useTty).toBe(true);
    expect(await readFile(path, "utf8")).toBe("use.tty=true\n# Stay here");
  });
});

describe("binding validation", () => {
  test("accepts hostnames, IPv4 and bracketed IPv6", () => {
    expect(() => validateBindings([
      relay(), relay("localhost:9080", "service.example:8443"), relay("[::1]:9081", "[2001:db8::1]:443"),
    ])).not.toThrow();
  });

  test("rejects malformed or unsupported endpoints before writing anything", () => {
    for (const invalid of ["https://host:443", "host", "host:0", "host:65536", "host:1/path", "host:443?x", "user@host:443", "host:443\n", "::1:443", "[invalid]:443", "bad_host:443", "999.999.999.999:443"]) {
      expect(() => validateBindings([relay(invalid)])).toThrow();
      expect(() => validateBindings([relay("localhost:9090", invalid)])).toThrow();
    }
    expect(() => validateBindings([{ ...relay(), kind: "other" } as unknown as RelayBinding])).toThrow("invalid relay type");
  });

  test("rejects duplicate effective properties and overlapping listeners", () => {
    expect(() => validateBindings([relay(), relay()])).toThrow("duplicates");
    expect(() => validateBindings([relay("LOCALHOST:9090"), { ...relay("localhost:09090"), kind: "sslRelay" }])).toThrow("overlap");
    expect(() => validateBindings([relay("0.0.0.0:9090"), relay("127.0.0.1:9090")])).toThrow("overlap");
    expect(() => validateBindings([relay("[::1]:9090"), relay("[0:0:0:0:0:0:0:1]:9090")])).toThrow("overlap");
    expect(() => validateBindings([
      { kind: "socks5", name: "proxy", bind: "localhost:9080", target: "" },
      { kind: "socks5", name: "proxy", bind: "localhost:9081", target: "" },
    ])).toThrow("duplicates");
  });
});
