export type RelayKind = "relay" | "sslRelay" | "socks5";

export interface RelayBinding {
  kind: RelayKind;
  /** Used only for the socks5.<name> property. */
  name: string;
  bind: string;
  target: string;
}

export interface LaunchSettings {
  sslLibraryPath: string;
  cryptoLibraryPath: string;
  configDirectory: string;
  identityMode: "ncrypt" | "pkcs11" | "pem" | "none";
  /** SHA-1 thumbprint of a CNG-backed certificate in Windows Current User / Personal. */
  windowsCertificateId: string;
  providerPath: string;
  pkcs11ModulePath: string;
  /** Absolute PEM file path or a PKCS#11 certificate URI. */
  certificate: string;
  /** Absolute PEM file path or a PKCS#11 private-key URI. */
  privateKey: string;
  caFile: string;
  localCertificatePath: string;
  localKeyPath: string;
}

export interface LaunchSecrets {
  /** Token PIN in PKCS#11 mode; private-key passphrase in PEM mode. */
  pin: string;
  localKeyPassphrase: string;
}

export interface WindowsCertificate {
  id: string;
  subject: string;
  issuer: string;
  validFrom: string;
  validTo: string;
  provider: string;
}

export interface Configuration {
  directory: string;
  exists: boolean;
  revision: string;
  bindings: RelayBinding[];
  useTty: boolean;
}

export interface LogEntry {
  id: number;
  time: string;
  source: "stdout" | "stderr" | "app";
  message: string;
}

export type ProcessStatus = "stopped" | "starting" | "running" | "stopping" | "failed";

export interface RelayState {
  status: ProcessStatus;
  startedAt: string | null;
  error: string | null;
  listeners: string[];
  connections: number;
  logs: LogEntry[];
}

export interface AppSnapshot {
  platform: string;
  settings: LaunchSettings;
  settingsError: string | null;
  configuration: Configuration | null;
  configurationError: string | null;
  relay: RelayState;
}

export type Result<T> = { ok: true; value: T } | { ok: false; error: string };

/** Shared shape consumed by both native and browser RPC definitions. */
export type RelayRPC = {
  bun: {
    requests: {
      snapshot: { params: {}; response: Result<AppSnapshot> };
      listWindowsCertificates: { params: {}; response: Result<WindowsCertificate[]> };
      loadConfiguration: { params: { directory: string }; response: Result<Configuration> };
      saveConfiguration: {
        params: { directory: string; revision: string; bindings: RelayBinding[] };
        response: Result<Configuration>;
      };
      saveSettings: { params: LaunchSettings; response: Result<LaunchSettings> };
      startRelay: { params: LaunchSecrets; response: Result<RelayState> };
      stopRelay: { params: {}; response: Result<RelayState> };
      clearLogs: { params: {}; response: Result<RelayState> };
    };
    messages: {};
  };
  webview: {
    requests: {};
    messages: {};
  };
};
