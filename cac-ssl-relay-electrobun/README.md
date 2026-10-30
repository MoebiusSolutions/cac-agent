# CAC SSL Relay for Electrobun

A Java-free implementation of `cac-ssl-relay`. TypeScript owns the listeners, SOCKS5 protocol, connection lifecycle, settings, and desktop interface. Windows uses Schannel TLS with NCrypt-backed certificate-store keys and the system PIN dialog. OpenSSL 3 provides the other TLS identity modes, including PKCS#11. Private token keys are not exported. The application launches no relay subprocesses.

## Run from source

Install Bun 1.4.4 or later and the [Electrobun platform prerequisites](https://framework.blackboard.sh/electrobun/guides/compatability/) for your operating system. Windows certificate-store mode uses built-in Windows TLS/CNG APIs and your existing smart-card driver; no OpenSSL or PKCS#11 provider configuration is required. OpenSSL-based modes require matching native OpenSSL 3 libraries. PKCS#11 mode additionally requires the [OpenSSL PKCS#11 provider](https://github.com/openssl-projects/pkcs11-provider) and card middleware such as OpenSC. Bun 1.4 includes the [Windows ARM64 FFI correction](https://bun.com/blog/bun-v1.4); native Windows tests use Bun 1.4.4.

```sh
cd cac-ssl-relay-electrobun
bun install --frozen-lockfile
bun run setup
bun start
```

`setup` downloads the pinned Electrobun 2.0.5 SDK/toolchain. `bun run dev` enables watching source files. Maven, a JDK, and a relay JAR are not needed.

For OpenSSL-based modes, the library defaults are `libssl.so.3` and `libcrypto.so.3` on Linux. On macOS, the app looks for Homebrew's OpenSSL 3 libraries under `/opt/homebrew/opt/openssl@3/lib` or `/usr/local/opt/openssl@3/lib`. Windows OpenSSL modes default to `libssl-3-x64.dll` / `libcrypto-3-x64.dll` (ARM64 names on ARM64). Enter absolute paths when needed, using a matched pair from the same OpenSSL installation. These fields are hidden and unused in Windows certificate-store mode.

## Windows certificate-store authentication

On Windows, **Windows certificate store / NCrypt** is the default identity mode. It uses the same Windows key storage providers as SmartPass, through the Schannel TLS implementation:

1. Insert your card and load your relay binding directory.
2. Click **Refresh certificates**, choose the appropriate client-authentication certificate, and save launch settings.
3. Start the relay and connect your client tool to a local listener.
4. When the upstream server requests a client certificate, Windows opens the installed provider's PIN dialog as needed. The app does not receive or save that PIN.

Certificates come from **Current User → Personal**. Discovery reads public metadata without opening keys or prompting for a PIN. It lists current RSA/ECDSA signing certificates with a registered CNG key association and compatible client-authentication usage. A saved selection is identified by its certificate thumbprint and remains visible if the card/certificate is unavailable. Refresh after adding or replacing a certificate. Existing saved PKCS#11 settings remain selectable; choose the Windows mode to switch.

Windows validates the server using the Windows trust configuration by default. An optional PEM CA bundle creates an application-private trust store and does not install roots into Windows. Custom-CA mode performs explicit chain/hostname verification before exposing application data; Schannel may request Windows key authentication earlier during that handshake. No certificate-validation bypass is exposed.

Windows 10 version 1809 or later is required by the Schannel credential API; TLS 1.3 is available where supported by Windows. TLS 1.0/1.1 are disabled. The packaged native binding is included with the app. A smart card still needs its normal Windows driver/minidriver, as with SmartPass.

## OpenSSL identity modes

Select **PKCS#11 smart card** as the identity mode and supply:

| Setting | Example |
| --- | --- |
| PKCS#11 provider | `/usr/lib/x86_64-linux-gnu/ossl-modules/pkcs11.so` |
| Card middleware | `/usr/lib/x86_64-linux-gnu/opensc-pkcs11.so` |
| Certificate | `pkcs11:token=Your%20Card;id=%01;type=cert` |
| Private key | `pkcs11:token=Your%20Card;id=%01;type=private` |
| Token PIN | Enter in the session-only password field |
| CA bundle | Optional absolute path to a PEM file of trusted upstream CA certificates |

Provider and middleware paths vary by installation. The provider setting can also be the installed provider name `pkcs11`. Identify your certificate/key using a unique [RFC 7512 PKCS#11 URI](https://www.rfc-editor.org/rfc/rfc7512). Tools such as `pkcs11-tool --module /path/to/middleware --list-objects` can show object IDs and labels. Do not put PINs in URIs; the app rejects PIN/query parameters in saved identity references.

The certificate setting also accepts an absolute PEM file containing the client certificate and any required intermediate certificates. This is useful when the card exposes only the leaf certificate. The private key can still stay on the card.

Enter the token PIN before starting. Authentication through a protected hardware PIN pad is not configured.

**PEM client certificate** mode accepts a PEM certificate chain and private key, with an optional session-only key passphrase. **No client certificate** mode supports upstream server TLS without client authentication. All modes verify the server's certificate chain and its DNS name or IP address and require TLS 1.2 or later. With no custom CA file, OpenSSL uses its configured default trust paths.

OpenSSL modes use OpenSSL's trust configuration and do not read Java JKS truststores. The Windows certificate-store mode above uses Windows trust and CNG instead.

The hardware interface was compared with SmartPass's native PKCS#11 and Windows CNG implementations. Its platform-specific C integer widths and session/PIN lifecycle informed the bindings and failure handling. SmartPass selects RSA certificates with both encryption and PKCS#1 v1.5 signing capabilities. TLS client authentication can use signing-only certificates and other algorithms, so the relay lets Schannel negotiate the appropriate CNG signature operation.

## Bindings and local TLS

The initial binding directory is `~/.moesol/cac-agent` (`%USERPROFILE%\.moesol\cac-agent` on Windows). Select a directory and click **Load**, then save launch settings if you changed them. Add/edit bindings and click **Save bindings** before starting.

The existing `agent.properties` binding format is supported:

```properties
relay.127.0.0.1\:9090=git.example.com:443
sslRelay.127.0.0.1\:9443=registry.example.com:443
socks5.development=127.0.0.1:9080
```

| Binding | Local connection | Upstream connection |
| --- | --- | --- |
| Plain → TLS | Plain TCP | TLS to a fixed destination |
| TLS → TLS | TLS with your local server certificate | TLS to a fixed destination |
| SOCKS5 → TLS | SOCKS5 CONNECT with plaintext application traffic | TLS to the client-selected destination |

For **TLS → TLS**, expand **Local TLS settings** and select a PEM server certificate and PEM private key. Enter its passphrase if encrypted. Client tools must trust that local server certificate. For example, a plain binding on `127.0.0.1:9090` targeting `git.example.com:443` lets a client access `http://127.0.0.1:9090/...` while the relay authenticates to the TLS upstream.

Each binding owns a listening address and port. SOCKS5 supports IPv4, IPv6, and domain destinations; domain names are retained for SNI and hostname verification. It offers no proxy authentication. New listeners default to loopback. This mode adds TLS itself, so the client must send plaintext application traffic through SOCKS5 rather than initiating another TLS connection inside it.

Legacy non-binding properties are preserved when saving. Java-specific `pkcs11.cfg`, `truststore.jks`, certificate-name settings, and `use.tty` are not used by this implementation. Configure the native identity in the desktop interface instead.

## Lifecycle and saved data

Start validates the native identity and binds every listener. A failure rolls back all listeners. **Relay running** means all configured listeners are bound. Stop/restart and closing the window close listeners, client connections, and native TLS sessions. Up to 256 clients are accepted; the latest 500 log entries remain in memory.

In Windows certificate-store mode, Windows owns PIN entry and caching; the app never reads the PIN. In OpenSSL modes, PINs and key passphrases stay in session memory and are provided through a native UI callback. Secrets are excluded from saved settings and redacted from displayed errors/logs. No PIN-bearing command line, environment variable, or configuration file is created by the application. The PKCS#11 provider may cache its PIN in memory for the active context; stopping releases that context and wipes the app's native PIN buffer.

Recognized PKCS#11 PIN, login, session, and card-removal errors block further native authentication attempts and close active native sessions. Correct the PIN or reconnect the card and explicitly restart the relay to retry. The failure remains visible in the status area even if logs are cleared; listeners can remain bound while authentication is blocked. Ordinary network and server-certificate failures do not block the token identity.

Desktop settings live at `~/.moesol/cac-ssl-relay-desktop/settings.json`. Binding saves preserve unrelated properties, comments, and credentials, reject stale revisions, and make `agent.properties.backup-…` copies before replacement. New settings files and backups use owner-only Unix permissions. Runtime and binding edits require stopping the relay.

Windows key acquisition and TLS handshake calls run asynchronously. Stop closes sockets immediately; native cleanup waits for an outstanding Windows PIN operation to return, so dismiss any pending system PIN dialog. Windows authentication failures require an explicit Restart before more client connections can trigger authentication. Windows handshakes allow up to 60 seconds for the PIN dialog. Native PKCS#11 calls remain synchronous; a blocked vendor call can delay controls until it returns, and its network handshakes have a 15-second timeout. Physical card insertion/removal, PIN-pad interaction, and vendor middleware behavior require testing with the intended hardware.

## Validate and package

```sh
bun run test
bun run typecheck
bun run build
```

Tests cover properties preservation/conflicts, secret handling, protocol fragmentation, listener rollback/cancellation, real native TLS/mTLS, certificate and hostname rejection, and bulk transfer/backpressure. Tests generate temporary certificates using the OpenSSL command-line tool; the desktop runtime uses the native libraries directly.

When a C compiler is available, native ABI tests compile small fixtures to verify Windows and Unix C integer widths, signed error returns, and 64-bit sizes.

An additional opt-in test creates an isolated SoftHSM token, generates a non-exportable key on it, stores its certificate, and authenticates native TLS connections using the token. Run it with paths to installed test tools:

```sh
CAC_TEST_PKCS11_PROVIDER=/absolute/path/to/pkcs11.so \
CAC_TEST_PKCS11_MODULE=/absolute/path/to/libsofthsm2.so \
CAC_TEST_SOFTHSM_UTIL=/absolute/path/to/softhsm2-util \
CAC_TEST_PKCS11_TOOL=/absolute/path/to/pkcs11-tool \
bun test tests/pkcs11.test.ts
```

This optional test is intended for Linux/macOS and never initializes a real card. It skips unless all four paths are explicitly set and the middleware path identifies SoftHSM.

Build separately on each target operating system. The stable bundle includes the Bun application, UI, and native addon under `build/stable-<platform>-<arch>/`. Windows certificate-store mode needs the normal Windows smart-card driver; OpenSSL-based modes additionally need their native libraries/providers. See [Electrobun's distribution guide](https://framework.blackboard.sh/electrobun/guides/quick-start/) for build details. Linux and Windows x64 builds and native TLS tests have been verified. Physical CAC/vendor-middleware behavior and macOS builds still need validation. Code signing and automatic updates are not configured.

The Windows build produces `artifacts/win-x64-CACSSLRelay-Setup.zip`. Extract the entire ZIP, including its `.installer` directory, then run `CAC SSL Relay-Setup.exe`. The application uses WebView2. Keep the installer payload beside the executable when distributing or running setup.
