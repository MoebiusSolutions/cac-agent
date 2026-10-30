type TokenFailureReason = "pin-incorrect" | "pin-locked" | "pin-invalid" | "pin-expired" | "token-unavailable" | "session-invalid" | "login-required";

/** A failed token identity must be explicitly restarted, never retried by clients. */
export class TokenAuthenticationError extends Error {
  constructor(readonly reason: TokenFailureReason, message: string) {
    super(message);
    this.name = "TokenAuthenticationError";
  }
}

/** Match PKCS#11 errors only; peer verification and network failures remain retryable. */
export function tokenAuthenticationError(error: unknown): TokenAuthenticationError | null {
  if (error instanceof TokenAuthenticationError) return error;
  const message = error instanceof Error ? error.message : String(error);
  const provider = /\bpkcs11\b/i.test(message);
  const matches = (code: string, reason: RegExp): boolean => new RegExp(`\\bCKR_${code}\\b`, "i").test(message) || (provider && reason.test(message));
  if (matches("PIN_INCORRECT", /The specified PIN is incorrect/i)) {
    return new TokenAuthenticationError("pin-incorrect", "The token PIN was rejected. Further token operations are blocked; restart the relay after correcting the PIN.");
  }
  if (matches("PIN_LOCKED", /The specified PIN is locked/i)) {
    return new TokenAuthenticationError("pin-locked", "The token PIN is locked. Unlock it using your card middleware, then restart the relay.");
  }
  if (matches("PIN_EXPIRED", /The specified PIN has expired/i)) {
    return new TokenAuthenticationError("pin-expired", "The token PIN has expired. Update it using your card middleware, then restart the relay.");
  }
  if (matches("PIN_(?:INVALID|LEN_RANGE)", /The specified PIN is invalid/i)) {
    return new TokenAuthenticationError("pin-invalid", "The token rejected the PIN format. Further token operations are blocked; correct the PIN and restart the relay.");
  }
  if (matches("(?:DEVICE_REMOVED|TOKEN_NOT_PRESENT|TOKEN_NOT_RECOGNIZED|DEVICE_ERROR)", /The token was removed|The token was not present|The token in the slot is not recognized|Some problem has occurred with the token and\/or slot/i)) {
    return new TokenAuthenticationError("token-unavailable", "The selected smart card became unavailable. Reconnect it and restart the relay.");
  }
  if (matches("(?:SESSION_HANDLE_INVALID|SESSION_CLOSED|KEY_HANDLE_INVALID)", /Invalid Session Handle|Session is already closed|The specified key handle is not valid/i)) {
    return new TokenAuthenticationError("session-invalid", "The smart-card session is no longer valid. Reconnect the selected card and restart the relay.");
  }
  if (matches("(?:USER_NOT_LOGGED_IN|USER_PIN_NOT_INITIALIZED)", /appropriate user is not logged in|The user PIN is not initialized/i)) {
    return new TokenAuthenticationError("login-required", "The smart-card login is no longer valid. Check the card and PIN, then restart the relay.");
  }
  return null;
}

export class TokenAuthenticationLatch {
  private failed: TokenAuthenticationError | null = null;

  constructor(private readonly pin: Uint8Array, private readonly onFailure: () => void) {}

  get failure(): TokenAuthenticationError | null { return this.failed; }

  assertAvailable(): void {
    if (this.failed) throw this.failed;
  }

  observe(error: unknown): TokenAuthenticationError | null {
    if (this.failed) return this.failed;
    const failure = tokenAuthenticationError(error);
    if (!failure) return null;
    this.failed = failure;
    this.pin.fill(0);
    this.onFailure();
    return failure;
  }
}
