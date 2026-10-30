import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { dlopen } from "bun:ffi";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openSSLAbi } from "../src/bun/openssl-ffi";

// Fixed-width functions model both C data models on any development host. The
// negative Windows result catches treating an int32 return register as int64.
describe.skipIf(!Bun.which("cc"))("OpenSSL native C ABI", () => {
  let directory: string;
  let path: string;
  beforeAll(async () => {
    directory = await mkdtemp(join(tmpdir(), "cac-openssl-abi-"));
    const source = join(directory, "abi.c");
    path = join(directory, process.platform === "darwin" ? "abi.dylib" : process.platform === "win32" ? "abi.dll" : "abi.so");
    await writeFile(source, `
#include <stddef.h>
#include <stdint.h>
#if defined(_WIN32)
#define EXPORT __declspec(dllexport)
#else
#define EXPORT
#endif
EXPORT int32_t windows_long(int32_t value) { return value - 1; }
EXPORT uint32_t windows_ulong(uint32_t value) { return value; }
EXPORT int64_t unix_long(int64_t value) { return value - 1; }
EXPORT uint64_t unix_ulong(uint64_t value) { return value; }
EXPORT long host_long(long value) { return value - 1; }
EXPORT unsigned long host_ulong(unsigned long value) { return value; }
EXPORT size_t native_size_t(size_t value) { return value + 3; }
`);
    const compiled = Bun.spawnSync(["cc", process.platform === "darwin" ? "-dynamiclib" : "-shared", "-fPIC", "-o", path, source], { stdout: "pipe", stderr: "pipe" });
    if (compiled.exitCode !== 0) throw new Error(compiled.stderr.toString());
  });
  afterAll(async () => { if (directory) await rm(directory, { recursive: true, force: true }); });

  test("Windows long returns stay signed and unsigned errors keep their high bit", () => {
    const abi = openSSLAbi("win32");
    const library = dlopen(path, {
      windows_long: { args: [abi.cLong], returns: abi.cLong },
      windows_ulong: { args: [abi.cUnsignedLong], returns: abi.cUnsignedLong },
      native_size_t: { args: [abi.sizeT], returns: abi.sizeT },
    });
    try {
      expect(library.symbols.windows_long(-2147483646)).toBe(-2147483647);
      expect(library.symbols.windows_ulong(0xf1234567)).toBe(0xf1234567);
      expect(library.symbols.native_size_t(0x100000000n)).toBe(0x100000003n);
    } finally { library.close(); }
  });

  test("LP64 Unix longs preserve values beyond 32 bits independently from size_t", () => {
    const abi = openSSLAbi("linux");
    const library = dlopen(path, {
      unix_long: { args: [abi.cLong], returns: abi.cLong },
      unix_ulong: { args: [abi.cUnsignedLong], returns: abi.cUnsignedLong },
      native_size_t: { args: [abi.sizeT], returns: abi.sizeT },
    });
    try {
      expect(library.symbols.unix_long(-0x100000000n)).toBe(-0x100000001n);
      expect(library.symbols.unix_ulong(0xabcdef0123456789n)).toBe(0xabcdef0123456789n);
      expect(library.symbols.native_size_t(0x100000000n)).toBe(0x100000003n);
    } finally { library.close(); }
  });

  test("the active platform bindings match compiler-native long and size_t", () => {
    const abi = openSSLAbi();
    const library = dlopen(path, {
      host_long: { args: [abi.cLong], returns: abi.cLong },
      host_ulong: { args: [abi.cUnsignedLong], returns: abi.cUnsignedLong },
      native_size_t: { args: [abi.sizeT], returns: abi.sizeT },
    });
    try {
      expect(Number(library.symbols.host_long(-1023))).toBe(-1024);
      expect(Number(library.symbols.host_ulong(0xf1234567))).toBe(0xf1234567);
      expect(library.symbols.native_size_t(0x100000000n)).toBe(0x100000003n);
    } finally { library.close(); }
  });
});
