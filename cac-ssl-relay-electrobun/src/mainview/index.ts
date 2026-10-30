import { Electroview } from "electrobun/view";
import type { AppSnapshot, Configuration, LaunchSettings, RelayBinding, RelayKind, RelayRPC, RelayState, Result, WindowsCertificate } from "../shared/types";

const rpc = Electroview.defineRPC<RelayRPC>({ handlers: { requests: {}, messages: {} } });
const view = new Electroview({ rpc });
void view;

function element<T extends HTMLElement>(id: string): T {
  const result = document.getElementById(id);
  if (!result) throw new Error(`Missing UI element: ${id}`);
  return result as T;
}

const inputs = {
  sslLibraryPath: element<HTMLInputElement>("ssl-library-path"),
  cryptoLibraryPath: element<HTMLInputElement>("crypto-library-path"),
  configDirectory: element<HTMLInputElement>("config-directory"),
  identityMode: element<HTMLSelectElement>("identity-mode"),
  windowsCertificateId: element<HTMLSelectElement>("windows-certificate-id"),
  providerPath: element<HTMLInputElement>("provider-path"),
  pkcs11ModulePath: element<HTMLInputElement>("pkcs11-module-path"),
  certificate: element<HTMLInputElement>("certificate"),
  privateKey: element<HTMLInputElement>("private-key"),
  caFile: element<HTMLInputElement>("ca-file"),
  localCertificatePath: element<HTMLInputElement>("local-certificate-path"),
  localKeyPath: element<HTMLInputElement>("local-key-path"),
};
const notification = element<HTMLDivElement>("notification");
const runtimeForm = element<HTMLFormElement>("runtime-form");
const pin = element<HTMLInputElement>("token-pin");
const localKeyPassphrase = element<HTMLInputElement>("local-key-passphrase");
const startButton = element<HTMLButtonElement>("start");
const stopButton = element<HTMLButtonElement>("stop");
const restartButton = element<HTMLButtonElement>("restart");
const settingsButton = element<HTMLButtonElement>("save-settings");
const bindingsButton = element<HTMLButtonElement>("save-bindings");
const addButton = element<HTMLButtonElement>("add-binding");
const addFirstButton = element<HTMLButtonElement>("add-first-binding");
const loadButton = element<HTMLButtonElement>("load-configuration");
const logs = element<HTMLDivElement>("logs");
const clearButton = element<HTMLButtonElement>("clear-logs");
const followLogs = element<HTMLInputElement>("follow-logs");
const refreshCertificatesButton = element<HTMLButtonElement>("refresh-certificates");
let configuration: Configuration | undefined;
let savedSettings: LaunchSettings | undefined;
let settingsLoadError: string | null = null;
let bindings: RelayBinding[] = [];
let relay: RelayState | undefined;
let busy = false;
let polling = false;
let lastLogKey = "";
let platform = "";
let windowsCertificates: WindowsCertificate[] | undefined;
let certificatesRefreshing = false;
let certificatesError: string | null = null;

function unwrap<T>(result: Result<T>): T {
  if (!result.ok) throw new Error(result.error);
  return result.value;
}

function message(text: string, success = false): void {
  notification.textContent = text;
  notification.classList.toggle("success", success);
  notification.hidden = false;
}

function readSettings(): LaunchSettings {
  return {
    sslLibraryPath: inputs.sslLibraryPath.value.trim(),
    cryptoLibraryPath: inputs.cryptoLibraryPath.value.trim(),
    configDirectory: inputs.configDirectory.value.trim(),
    identityMode: inputs.identityMode.value as LaunchSettings["identityMode"],
    windowsCertificateId: inputs.windowsCertificateId.value,
    providerPath: inputs.providerPath.value.trim(),
    pkcs11ModulePath: inputs.pkcs11ModulePath.value.trim(),
    certificate: inputs.certificate.value.trim(),
    privateKey: inputs.privateKey.value.trim(),
    caFile: inputs.caFile.value.trim(),
    localCertificatePath: inputs.localCertificatePath.value.trim(),
    localKeyPath: inputs.localKeyPath.value.trim(),
  };
}

function settingsDirty(): boolean {
  if (!savedSettings) return false;
  const current = readSettings();
  return (Object.keys(current) as (keyof LaunchSettings)[]).some(key => current[key] !== savedSettings?.[key]);
}

function bindingsDirty(): boolean {
  if (!configuration) return false;
  return bindings.length !== configuration.bindings.length || bindings.some((binding, index) => {
    const saved = configuration?.bindings[index];
    return !saved || binding.kind !== saved.kind || binding.name !== saved.name || binding.bind !== saved.bind || binding.target !== saved.target;
  });
}

function isActive(): boolean {
  return !!relay && ["starting", "running", "stopping"].includes(relay.status);
}

function sameDirectory(): boolean {
  return !!configuration && inputs.configDirectory.value.trim() === configuration.directory;
}

function updateControls(): void {
  const ready = !!configuration && !!savedSettings && !!relay;
  const active = isActive();
  const settingsChanged = settingsDirty();
  const bindingsChanged = bindingsDirty();
  const mode = inputs.identityMode.value;
  const windowsIdentity = mode === "ncrypt";
  const canLaunch = ready && !settingsChanged && !settingsLoadError && !bindingsChanged && sameDirectory() && bindings.length > 0 && (!windowsIdentity || !!inputs.windowsCertificateId.value);
  startButton.disabled = busy || certificatesRefreshing || active || !canLaunch;
  stopButton.disabled = busy || !active || relay?.status === "stopping";
  restartButton.disabled = busy || certificatesRefreshing || relay?.status !== "running" || !canLaunch;
  settingsButton.disabled = busy || certificatesRefreshing || active || !ready || (!settingsChanged && !settingsLoadError);
  bindingsButton.disabled = busy || active || !configuration || !sameDirectory() || (!bindingsChanged && configuration.exists);
  addButton.disabled = busy || active || !configuration || !sameDirectory();
  addFirstButton.disabled = addButton.disabled;
  loadButton.disabled = busy || active || !inputs.configDirectory.value.trim();
  clearButton.disabled = busy || !relay?.logs.length;
  for (const input of Object.values(inputs)) input.disabled = busy || active;
  refreshCertificatesButton.disabled = busy || active || certificatesRefreshing || platform !== "win32";
  refreshCertificatesButton.textContent = certificatesRefreshing ? "Refreshing…" : "Refresh certificates";
  const windowsOption = element<HTMLOptionElement>("ncrypt-option");
  windowsOption.hidden = platform !== "win32";
  windowsOption.disabled = platform !== "win32";
  inputs.windowsCertificateId.disabled = busy || active || !windowsIdentity;
  inputs.windowsCertificateId.required = windowsIdentity;
  inputs.sslLibraryPath.disabled = inputs.cryptoLibraryPath.disabled = busy || active || windowsIdentity;
  inputs.sslLibraryPath.required = inputs.cryptoLibraryPath.required = !windowsIdentity;
  pin.disabled = busy || active || windowsIdentity || mode === "none";
  element<HTMLDivElement>("bindings").querySelectorAll<HTMLInputElement | HTMLSelectElement | HTMLButtonElement>("input, select, button").forEach(input => { input.disabled = busy || active; });

  const settingsLabel = element<HTMLSpanElement>("settings-saved");
  settingsLabel.textContent = savedSettings ? settingsLoadError ? "Recovery needed" : settingsChanged ? "Unsaved changes" : "Saved" : "Loading";
  settingsLabel.className = `save-label ${settingsChanged || settingsLoadError ? "dirty" : "saved"}`;
  const bindingLabel = element<HTMLSpanElement>("bindings-saved");
  bindingLabel.textContent = !configuration ? savedSettings ? "Configuration unavailable" : "Loading" : bindingsChanged ? "Unsaved changes" : configuration.exists ? "Saved to agent.properties" : "No agent.properties file";
  bindingLabel.className = `save-label ${bindingsChanged ? "dirty" : "saved"}`;
  element<HTMLSpanElement>("binding-count").textContent = String(bindings.length);
  const emptyState = element<HTMLDivElement>("empty-bindings");
  emptyState.hidden = bindings.length > 0 || !savedSettings;
  const emptyHeading = emptyState.querySelector("h3");
  const emptyDescription = emptyState.querySelector("p");
  if (emptyHeading) emptyHeading.textContent = configuration ? "No bindings configured" : "Load a configuration";
  if (emptyDescription) emptyDescription.textContent = configuration ? "Add a local listener and a destination, or load an existing configuration directory." : "Choose a valid configuration directory in Launch settings, then select Load. Your process controls remain available.";
  addFirstButton.hidden = !configuration;
  element<HTMLDivElement>("openssl-settings").hidden = windowsIdentity;
  element<HTMLDivElement>("windows-settings").hidden = !windowsIdentity;
  element<HTMLDivElement>("pkcs11-settings").hidden = mode !== "pkcs11";
  element<HTMLDivElement>("identity-settings").hidden = windowsIdentity || mode === "none";
  element<HTMLLabelElement>("pin-label").textContent = mode === "pkcs11" ? "Token PIN" : "Private-key passphrase";
  inputs.certificate.placeholder = mode === "pkcs11" ? "pkcs11:object=CAC%20ID;type=cert" : "/path/to/client-chain.pem";
  inputs.privateKey.placeholder = mode === "pkcs11" ? "pkcs11:object=CAC%20ID;type=private" : "/path/to/client-key.pem";
  element<HTMLParagraphElement>("identity-help").textContent = mode === "pkcs11" ? "Select your certificate and key by PKCS#11 URI. Signing stays on the card." : "Supply the client certificate chain and private key as PEM files.";
  inputs.caFile.placeholder = windowsIdentity ? "Windows certificate-store trust by default" : "System OpenSSL trust by default";
  element<HTMLParagraphElement>("smart-card-help").textContent = windowsIdentity ? "Insert your CAC before refreshing certificates or starting. Windows will show its PIN dialog when the selected card signs a TLS connection." : mode === "pkcs11" ? "Insert your CAC before starting. The native PKCS#11 provider uses your selected key without exporting it from the card." : mode === "pem" ? "Your certificate and private key are loaded from the selected PEM files. Key passphrases are never saved." : "The relay verifies upstream server certificates without supplying a client certificate.";
  renderWindowsCertificateDetails();
  element<HTMLSpanElement>("config-file-status").textContent = !configuration ? "Choose a directory and select Load." : !sameDirectory() ? "Load this directory to edit its bindings." : configuration.exists ? "agent.properties loaded" : "Save bindings to create agent.properties.";
  element<HTMLParagraphElement>("bindings-help").textContent = active ? "Stop the relay to edit its configuration." : "Other agent.properties settings are preserved.";
  element<HTMLSpanElement>("save-hint").textContent = relay?.status === "running" ? "All configured listeners are bound. Connection activity appears in the log." : active ? "Updating listeners and active connections…" : !sameDirectory() ? "Load the selected configuration directory." : settingsLoadError ? "Save launch settings to replace the invalid settings file." : settingsChanged || bindingsChanged ? "Save changes before starting the relay." : windowsIdentity && !inputs.windowsCertificateId.value ? "Choose a Windows client certificate and save launch settings." : !bindings.length ? "Add a binding to get started." : "Ready to start the relay.";
}

function certificateName(subject: string): string {
  const commonName = /(?:^|[,\n])\s*CN\s*=\s*(?:"((?:[^"\\]|\\.)*)"|((?:\\.|[^,\n])*))/i.exec(subject);
  return (commonName?.[1] ?? commonName?.[2] ?? subject).replace(/\\([,="\\])/g, "$1").trim() || "Unnamed certificate";
}

function certificateDate(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleDateString();
}

function renderWindowsCertificateOptions(selected = inputs.windowsCertificateId.value): void {
  const options = document.createDocumentFragment();
  const empty = newNode("option", "", "Select a certificate…");
  empty.value = "";
  options.append(empty);
  const certificates = [...(windowsCertificates ?? [])].sort((left, right) => certificateName(left.subject).localeCompare(certificateName(right.subject)) || left.id.localeCompare(right.id));
  for (const certificate of certificates) {
    const option = newNode("option", "", `${certificateName(certificate.subject)} · expires ${certificateDate(certificate.validTo)} · ${certificate.id.slice(-8)}`);
    option.value = certificate.id;
    options.append(option);
  }
  if (selected && !certificates.some(certificate => certificate.id === selected)) {
    const unavailable = newNode("option", "", `${windowsCertificates ? "Unavailable" : "Saved certificate"} · ${selected.slice(-8)}`);
    unavailable.value = selected;
    options.append(unavailable);
  }
  inputs.windowsCertificateId.replaceChildren(options);
  inputs.windowsCertificateId.value = selected;
}

function renderWindowsCertificateDetails(): void {
  const selected = inputs.windowsCertificateId.value;
  const certificate = windowsCertificates?.find(item => item.id === selected);
  const details = element<HTMLDListElement>("windows-certificate-details");
  details.replaceChildren();
  details.hidden = !selected;
  const rows: [string, string][] = certificate ? [
    ["Issued to", certificateName(certificate.subject)],
    ["Issuer", certificateName(certificate.issuer)],
    ["Valid", `${certificateDate(certificate.validFrom)} – ${certificateDate(certificate.validTo)}`],
    ["Provider", certificate.provider || "Windows key storage provider"],
    ["Thumbprint", certificate.id],
  ] : selected ? [["Thumbprint", selected]] : [];
  for (const [label, value] of rows) details.append(newNode("dt", "", label), newNode("dd", "", value));
  const status = element<HTMLSpanElement>("windows-certificate-status");
  status.classList.toggle("certificate-warning", !!certificatesError || !!selected && windowsCertificates !== undefined && !certificate);
  status.textContent = certificatesRefreshing ? "Reading Windows client certificates…" : certificatesError ? certificatesError : selected && windowsCertificates !== undefined && !certificate ? "The selected certificate is unavailable. Insert its card and refresh, or choose another certificate. Your selection has been kept." : windowsCertificates === undefined ? "Insert your CAC, then refresh certificates." : !windowsCertificates.length ? "No supported client certificates found. Insert your CAC and refresh." : `${windowsCertificates.length} client certificate${windowsCertificates.length === 1 ? "" : "s"} available.`;
}

async function refreshWindowsCertificates(): Promise<void> {
  if (platform !== "win32" || certificatesRefreshing || busy || isActive()) return;
  certificatesRefreshing = true;
  certificatesError = null;
  updateControls();
  try {
    windowsCertificates = unwrap(await rpc.request.listWindowsCertificates({}));
    // Read the current value after the request so a selection made during refresh is preserved.
    renderWindowsCertificateOptions();
  } catch (error) {
    certificatesError = error instanceof Error ? error.message : String(error);
  } finally {
    certificatesRefreshing = false;
    updateControls();
  }
}

function newNode<K extends keyof HTMLElementTagNameMap>(tag: K, className = "", text = ""): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  node.className = className;
  node.textContent = text;
  return node;
}

function bindingInput(labelText: string, value: string, id: string, onInput: (value: string) => void): HTMLDivElement {
  const wrapper = newNode("div", "binding-field");
  const label = newNode("label", "", labelText);
  label.htmlFor = id;
  const input = newNode("input");
  input.type = "text";
  input.id = id;
  input.value = value;
  input.spellcheck = false;
  input.autocomplete = "off";
  input.addEventListener("input", () => { onInput(input.value); updateControls(); });
  wrapper.append(label, input);
  return wrapper;
}

function renderBindings(): void {
  const list = element<HTMLDivElement>("bindings");
  list.replaceChildren();
  bindings.forEach((binding, index) => {
    const card = newNode("div", "binding-card");
    const top = newNode("div", "binding-top");
    const select = newNode("select");
    select.setAttribute("aria-label", `Binding ${index + 1} type`);
    const kinds: [RelayKind, string][] = [["relay", "Plain → TLS"], ["sslRelay", "TLS → TLS"], ["socks5", "SOCKS5 → TLS"]];
    for (const [value, label] of kinds) {
      const option = newNode("option", "", label);
      option.value = value;
      select.append(option);
    }
    select.value = binding.kind;
    select.addEventListener("change", () => {
      const next = select.value as RelayKind;
      binding.kind = next;
      if (next === "socks5") {
        binding.name ||= `proxy-${index + 1}`;
        binding.target = "";
      } else {
        binding.name = "";
      }
      renderBindings();
      updateControls();
    });
    const number = newNode("span", "binding-number", `LISTENER ${String(index + 1).padStart(2, "0")}`);
    const remove = newNode("button", "remove-binding", "×");
    remove.type = "button";
    remove.title = `Remove binding ${index + 1}`;
    remove.setAttribute("aria-label", remove.title);
    remove.addEventListener("click", () => { bindings.splice(index, 1); renderBindings(); updateControls(); });
    top.append(select, number, remove);
    const endpoints = newNode("div", "binding-endpoints");
    const bind = bindingInput("LOCAL LISTENER", binding.bind, `bind-${index}`, value => { binding.bind = value; });
    (bind.querySelector("input") as HTMLInputElement).placeholder = "127.0.0.1:9090";
    endpoints.append(bind, newNode("span", "endpoint-arrow", "→"));
    if (binding.kind === "socks5") {
      const destination = newNode("div", "binding-field");
      destination.append(newNode("label", "", "UPSTREAM DESTINATION"), newNode("p", "binding-description", "Selected by your client"));
      endpoints.append(destination);
    } else {
      const target = bindingInput("TLS DESTINATION", binding.target, `target-${index}`, value => { binding.target = value; });
      (target.querySelector("input") as HTMLInputElement).placeholder = "service.example.com:443";
      endpoints.append(target);
    }
    card.append(top, endpoints);
    if (binding.kind === "socks5") {
      const socksName = newNode("div", "socks-name");
      const label = newNode("label", "", "Proxy name");
      const name = newNode("input");
      name.type = "text";
      name.id = `socks-name-${index}`;
      label.htmlFor = name.id;
      name.value = binding.name;
      name.spellcheck = false;
      name.addEventListener("input", () => { binding.name = name.value; updateControls(); });
      socksName.append(label, name);
      card.append(socksName);
    }
    list.append(card);
  });
}

function applyConfiguration(value: Configuration): void {
  configuration = value;
  bindings = value.bindings.map(binding => ({ ...binding }));
  inputs.configDirectory.value = value.directory;
  renderBindings();
  updateControls();
}

function renderRelay(value: RelayState): void {
  relay = value;
  const labels: Record<RelayState["status"], string> = {
    stopped: "Relay stopped", starting: "Starting relay…", running: "Relay running", stopping: "Stopping relay…", failed: "Relay failed",
  };
  element<HTMLHeadingElement>("status-heading").textContent = labels[value.status];
  element<HTMLSpanElement>("status-dot").className = `status-dot ${value.status}`;
  const started = value.startedAt ? new Date(value.startedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : "";
  element<HTMLParagraphElement>("process-detail").textContent = value.error || (value.status === "running" ? `${value.listeners.length} listener${value.listeners.length === 1 ? "" : "s"} bound · ${value.connections} active connection${value.connections === 1 ? "" : "s"} · Started ${started}` : value.status === "starting" ? "Checking your native TLS identity and binding the saved listeners." : value.status === "stopping" ? "Closing listeners and active connections." : "Start the relay to connect your tools through your CAC.");
  renderLogs(value);
  updateControls();
}

function renderLogs(value: RelayState): void {
  const key = `${value.logs.length}:${value.logs[0]?.id ?? ""}:${value.logs.at(-1)?.id ?? ""}`;
  if (key === lastLogKey) return;
  lastLogKey = key;
  element<HTMLSpanElement>("log-count").textContent = String(value.logs.length);
  const fragment = document.createDocumentFragment();
  if (!value.logs.length) fragment.append(newNode("p", "logs-empty", "Relay activity will appear here when you start."));
  for (const entry of value.logs) {
    const row = newNode("div", "log-row");
    row.append(newNode("span", "log-time", new Date(entry.time).toLocaleTimeString([], { hour12: false })), newNode("span", `log-source ${entry.source}`, entry.source), newNode("span", "log-message", entry.message));
    fragment.append(row);
  }
  logs.replaceChildren(fragment);
  if (followLogs.checked) logs.scrollTop = logs.scrollHeight;
}

async function action(work: () => Promise<void>): Promise<void> {
  if (busy) return;
  busy = true;
  notification.hidden = true;
  updateControls();
  try { await work(); } catch (error) { message(error instanceof Error ? error.message : String(error)); } finally { busy = false; updateControls(); }
}

runtimeForm.addEventListener("input", updateControls);
runtimeForm.addEventListener("change", updateControls);
inputs.identityMode.addEventListener("change", () => {
  if (inputs.identityMode.value === "ncrypt" && windowsCertificates === undefined) void refreshWindowsCertificates();
});
refreshCertificatesButton.addEventListener("click", () => void refreshWindowsCertificates());
runtimeForm.addEventListener("submit", event => {
  event.preventDefault();
  void action(async () => {
    if (!runtimeForm.reportValidity()) return;
    if (!sameDirectory()) throw new Error("Load the selected configuration directory before saving launch settings.");
    if (inputs.identityMode.value === "ncrypt" && !inputs.windowsCertificateId.value) throw new Error("Choose a Windows client certificate before saving launch settings.");
    savedSettings = unwrap(await rpc.request.saveSettings(readSettings()));
    settingsLoadError = null;
    renderWindowsCertificateOptions(savedSettings.windowsCertificateId);
    for (const key of Object.keys(inputs) as (keyof LaunchSettings)[]) inputs[key].value = savedSettings[key];
    message("Launch settings saved.", true);
  });
});

loadButton.addEventListener("click", () => void action(async () => {
  applyConfiguration(unwrap(await rpc.request.loadConfiguration({ directory: inputs.configDirectory.value.trim() })));
  message("Configuration loaded. Save launch settings to use this directory for the relay.", true);
}));

function addBinding(): void {
  bindings.push({ kind: "relay", name: "", bind: `127.0.0.1:${9090 + bindings.length}`, target: "" });
  renderBindings();
  updateControls();
  element<HTMLInputElement>(`target-${bindings.length - 1}`).focus();
}
addButton.addEventListener("click", addBinding);
addFirstButton.addEventListener("click", addBinding);

bindingsButton.addEventListener("click", () => void action(async () => {
  if (!configuration) return;
  const updated = unwrap(await rpc.request.saveConfiguration({ directory: configuration.directory, revision: configuration.revision, bindings }));
  applyConfiguration(updated);
  message("Relay bindings saved. Other agent.properties settings were preserved.", true);
}));

function sessionPin(): string {
  return ["ncrypt", "none"].includes(inputs.identityMode.value) ? "" : pin.value;
}

startButton.addEventListener("click", () => void action(async () => {
  renderRelay(unwrap(await rpc.request.startRelay({ pin: sessionPin(), localKeyPassphrase: localKeyPassphrase.value })));
}));
stopButton.addEventListener("click", () => void action(async () => { renderRelay(unwrap(await rpc.request.stopRelay({}))); }));
restartButton.addEventListener("click", () => void action(async () => {
  renderRelay(unwrap(await rpc.request.stopRelay({})));
  renderRelay(unwrap(await rpc.request.startRelay({ pin: sessionPin(), localKeyPassphrase: localKeyPassphrase.value })));
}));
clearButton.addEventListener("click", () => void action(async () => { renderRelay(unwrap(await rpc.request.clearLogs({}))); }));
followLogs.addEventListener("change", () => { if (followLogs.checked) logs.scrollTop = logs.scrollHeight; });

async function poll(): Promise<void> {
  if (polling || busy) return;
  polling = true;
  try {
    const snapshot: AppSnapshot = unwrap(await rpc.request.snapshot({}));
    if (busy) return;
    if (!savedSettings) {
      platform = snapshot.platform;
      savedSettings = snapshot.settings;
      settingsLoadError = snapshot.settingsError;
      renderWindowsCertificateOptions(snapshot.settings.windowsCertificateId);
      for (const key of Object.keys(inputs) as (keyof LaunchSettings)[]) inputs[key].value = snapshot.settings[key];
      if (snapshot.settings.localCertificatePath) element<HTMLDetailsElement>("tls-settings").open = true;
      if (snapshot.configuration) applyConfiguration(snapshot.configuration);
      const startupErrors = [snapshot.settingsError, snapshot.configurationError].filter((error): error is string => !!error);
      if (startupErrors.length) message(startupErrors.join("\n"));
      else notification.hidden = true;
    }
    renderRelay(snapshot.relay);
    if (platform === "win32" && inputs.identityMode.value === "ncrypt" && windowsCertificates === undefined && !certificatesError) void refreshWindowsCertificates();
  } catch (error) {
    message(error instanceof Error ? error.message : String(error));
  } finally { polling = false; }
}

void poll();
setInterval(() => void poll(), 1000);
