import { CString, dlopen, FFIType as T, ptr, type Pointer } from "bun:ffi";

/** Windows is LLP64: C long is 32 bits while pointers and size_t are 64 bits. */
export function openSSLAbi(platform: NodeJS.Platform = process.platform) {
  return {
    cLong: platform === "win32" ? T.i32 : T.i64,
    cUnsignedLong: platform === "win32" ? T.u32 : T.u64,
    sizeT: T.u64,
  } as const;
}

/** OpenSSL 3's public ABI. TLS runs against memory BIOs; JavaScript owns sockets. */
export function loadOpenSSL(sslLibrary: string, cryptoLibrary: string) {
  const abi = openSSLAbi();
  const crypto = dlopen(cryptoLibrary, {
    OPENSSL_version_major: { args: [], returns: T.u32 },
    OSSL_LIB_CTX_new: { args: [], returns: T.ptr },
    OSSL_LIB_CTX_free: { args: [T.ptr], returns: T.void },
    OSSL_LIB_CTX_load_config: { args: [T.ptr, T.ptr], returns: T.int },
    OSSL_PROVIDER_load: { args: [T.ptr, T.ptr], returns: T.ptr },
    OSSL_PROVIDER_unload: { args: [T.ptr], returns: T.int },
    OSSL_STORE_open_ex: { args: [T.ptr, T.ptr, T.ptr, T.ptr, T.ptr, T.ptr, T.ptr, T.ptr], returns: T.ptr },
    OSSL_STORE_expect: { args: [T.ptr, T.int], returns: T.int },
    OSSL_STORE_load: { args: [T.ptr], returns: T.ptr },
    OSSL_STORE_eof: { args: [T.ptr], returns: T.int },
    OSSL_STORE_INFO_get_type: { args: [T.ptr], returns: T.int },
    OSSL_STORE_INFO_get1_PKEY: { args: [T.ptr], returns: T.ptr },
    OSSL_STORE_INFO_get1_CERT: { args: [T.ptr], returns: T.ptr },
    OSSL_STORE_INFO_free: { args: [T.ptr], returns: T.void },
    OSSL_STORE_close: { args: [T.ptr], returns: T.int },
    EVP_PKEY_free: { args: [T.ptr], returns: T.void },
    X509_free: { args: [T.ptr], returns: T.void },
    X509_VERIFY_PARAM_set1_ip_asc: { args: [T.ptr, T.ptr], returns: T.int },
    UI_create_method: { args: [T.ptr], returns: T.ptr },
    UI_destroy_method: { args: [T.ptr], returns: T.void },
    UI_method_set_reader: { args: [T.ptr, T.ptr], returns: T.int },
    UI_get_string_type: { args: [T.ptr], returns: T.int },
    UI_set_result: { args: [T.ptr, T.ptr, T.ptr], returns: T.int },
    ERR_clear_error: { args: [], returns: T.void },
    ERR_get_error: { args: [], returns: abi.cUnsignedLong },
    ERR_error_string_n: { args: [abi.cUnsignedLong, T.ptr, abi.sizeT], returns: T.void },
    BIO_s_mem: { args: [], returns: T.ptr },
    BIO_new: { args: [T.ptr], returns: T.ptr },
    BIO_free: { args: [T.ptr], returns: T.int },
    BIO_write: { args: [T.ptr, T.ptr, T.int], returns: T.int },
    BIO_read: { args: [T.ptr, T.ptr, T.int], returns: T.int },
    BIO_ctrl: { args: [T.ptr, T.int, abi.cLong, T.ptr], returns: abi.cLong },
    BIO_ctrl_pending: { args: [T.ptr], returns: abi.sizeT },
  });
  try {
    if (crypto.symbols.OPENSSL_version_major() !== 3) throw new Error("The native relay requires OpenSSL 3 libraries.");
    const ssl = dlopen(sslLibrary, {
      TLS_client_method: { args: [], returns: T.ptr },
      SSL_CTX_new_ex: { args: [T.ptr, T.ptr, T.ptr], returns: T.ptr },
      SSL_CTX_free: { args: [T.ptr], returns: T.void },
      SSL_CTX_ctrl: { args: [T.ptr, T.int, abi.cLong, T.ptr], returns: abi.cLong },
      SSL_CTX_set_verify: { args: [T.ptr, T.int, T.ptr], returns: T.void },
      SSL_CTX_set_default_verify_paths: { args: [T.ptr], returns: T.int },
      SSL_CTX_load_verify_locations: { args: [T.ptr, T.ptr, T.ptr], returns: T.int },
      SSL_CTX_use_certificate_chain_file: { args: [T.ptr, T.ptr], returns: T.int },
      SSL_CTX_use_certificate: { args: [T.ptr, T.ptr], returns: T.int },
      SSL_CTX_use_PrivateKey: { args: [T.ptr, T.ptr], returns: T.int },
      SSL_CTX_check_private_key: { args: [T.ptr], returns: T.int },
      SSL_new: { args: [T.ptr], returns: T.ptr },
      SSL_free: { args: [T.ptr], returns: T.void },
      SSL_set_bio: { args: [T.ptr, T.ptr, T.ptr], returns: T.void },
      SSL_set_connect_state: { args: [T.ptr], returns: T.void },
      SSL_set1_host: { args: [T.ptr, T.ptr], returns: T.int },
      SSL_set_hostflags: { args: [T.ptr, T.u32], returns: T.void },
      SSL_get0_param: { args: [T.ptr], returns: T.ptr },
      SSL_ctrl: { args: [T.ptr, T.int, abi.cLong, T.ptr], returns: abi.cLong },
      SSL_do_handshake: { args: [T.ptr], returns: T.int },
      SSL_get_error: { args: [T.ptr, T.int], returns: T.int },
      SSL_get_verify_result: { args: [T.ptr], returns: abi.cLong },
      SSL_read_ex: { args: [T.ptr, T.ptr, abi.sizeT, T.ptr], returns: T.int },
      SSL_write_ex: { args: [T.ptr, T.ptr, abi.sizeT, T.ptr], returns: T.int },
      SSL_shutdown: { args: [T.ptr], returns: T.int },
    });
    const api = { ...crypto.symbols, ...ssl.symbols };
    return {
      api,
      error(message: string): Error {
        const errors: string[] = [];
        for (let code = api.ERR_get_error(); Number(code) !== 0; code = api.ERR_get_error()) {
          const buffer = Buffer.alloc(256);
          api.ERR_error_string_n(code, ptr(buffer), buffer.length);
          errors.push(new CString(ptr(buffer)).toString());
        }
        return new Error(errors.length ? `${message}: ${errors.join("; ")}` : message);
      },
      close() { ssl.close(); crypto.close(); },
    };
  } catch (error) {
    crypto.close();
    throw error;
  }
}

export type OpenSSL = ReturnType<typeof loadOpenSSL>;
export type NativePointer = Pointer | bigint;

/** Keep the returned buffer alive until the synchronous FFI call completes. */
export function cString(value: string): Buffer {
  if (value.includes("\0")) throw new Error("Native text arguments cannot contain NUL.");
  return Buffer.from(`${value}\0`, "utf8");
}
