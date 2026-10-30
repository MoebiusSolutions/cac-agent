import { expect, test } from "bun:test";
import { TokenAuthenticationLatch, tokenAuthenticationError } from "../src/bun/token-auth";

test("a token authentication failure wipes the PIN, closes sessions once, and blocks subsequent native operations", () => {
  const pin = Buffer.from("123456\0");
  let closed = 0;
  let nativeCalls = 0;
  const latch = new TokenAuthenticationLatch(pin, () => { closed++; });
  const operation = (error?: Error) => {
    latch.assertAvailable();
    nativeCalls++;
    if (error) {
      const fatal = latch.observe(error);
      if (fatal) throw fatal;
    }
  };
  expect(() => operation(new Error("Native TLS handshake failed: error:408000A0:pkcs11::The specified PIN is incorrect"))).toThrow("restart the relay");
  expect(pin).toEqual(Buffer.alloc(pin.length));
  expect(closed).toBe(1);
  for (let i = 0; i < 8; i++) expect(() => operation()).toThrow("PIN was rejected");
  expect(nativeCalls).toBe(1);
  latch.observe(new Error("CKR_PIN_LOCKED"));
  expect(closed).toBe(1);
  expect(latch.failure?.reason).toBe("pin-incorrect");
  const restarted = new TokenAuthenticationLatch(Buffer.from("corrected-pin\0"), () => {});
  expect(() => restarted.assertAvailable()).not.toThrow();
});

test("specific PKCS#11 credential, session and removal failures explain the required recovery", () => {
  const failures = [
    ["CKR_PIN_LOCKED", "pin-locked"],
    ["CKR_PIN_INVALID", "pin-invalid"],
    ["pkcs11::The specified PIN has expired", "pin-expired"],
    ["pkcs11::The token was removed from its slot during the execution of the function", "token-unavailable"],
    ["CKR_TOKEN_NOT_PRESENT", "token-unavailable"],
    ["pkcs11::Invalid Session Handle", "session-invalid"],
    ["CKR_KEY_HANDLE_INVALID", "session-invalid"],
    ["pkcs11::an appropriate user is not logged in", "login-required"],
  ] as const;
  for (const [message, reason] of failures) {
    const failure = tokenAuthenticationError(new Error(message));
    expect(failure?.reason).toBe(reason);
    expect(failure?.message).toMatch(/restart the relay/i);
  }
});

test("network failures, peer verification failures and non-provider text never disable a token identity", () => {
  const pin = Buffer.from("123456\0");
  let invalidated = 0;
  const latch = new TokenAuthenticationLatch(pin, () => { invalidated++; });
  for (const message of [
    "connect ECONNREFUSED 127.0.0.1:443", "TLS handshake timed out", "TLS handshake or peer verification failed: SSL routines::certificate verify failed",
    "TLS handshake or peer verification failed: error:0A00045C:SSL routines::tlsv13 alert certificate required",
    "The specified PIN is incorrect", "pkcs11::General Error",
  ]) {
    latch.assertAvailable();
    expect(latch.observe(new Error(message))).toBeNull();
  }
  expect(invalidated).toBe(0);
  expect(pin.toString()).toBe("123456\0");
});
