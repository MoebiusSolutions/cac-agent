import Electrobun, { BrowserView, BrowserWindow, PATHS, Utils, type ElectrobunEvent } from "electrobun/main";
import { join } from "node:path";
import { readConfiguration, saveConfiguration } from "./configuration";
import { RelayEngine } from "./relay-engine";
import { defaultSettings, SettingsStore } from "./settings";
import { listWindowsCertificates } from "./windows-certificates";
import { installWindowsWindowIcon } from "./windows-window-icon";
import type { RelayRPC, Result } from "../shared/types";

const relay = new RelayEngine();
const store = new SettingsStore(defaultSettings());
let settings = defaultSettings();
let settingsError: string | null = null;
try { settings = await store.load(); }
catch (error) {
  settingsError = `${error instanceof Error ? error.message : String(error)}. Defaults were loaded; save launch settings to replace the invalid settings file.`;
}
let closing = false;
let operations: Promise<unknown> = Promise.resolve();

async function result<T>(action: () => Promise<T> | T): Promise<Result<T>> {
  try { return { ok: true, value: await action() }; }
  catch (error) { return { ok: false, error: error instanceof Error ? error.message : String(error) }; }
}

/** Serialize writes and process controls even when multiple RPC requests arrive. */
function mutate<T>(action: () => Promise<T> | T): Promise<Result<T>> {
  const next = operations.then(() => result(() => {
    if (closing) throw new Error("The desktop application is closing.");
    return action();
  }));
  operations = next;
  return next;
}

function requireStopped(): void {
  if (relay.isActive()) throw new Error("Stop the relay before changing runtime settings or bindings.");
}

const rpc = BrowserView.defineRPC<RelayRPC>({
  maxRequestTime: 15000,
  handlers: {
    requests: {
      snapshot: () => result(async () => {
        const configuration = await result(() => readConfiguration(settings.configDirectory));
        return {
          platform: process.platform,
          settings,
          settingsError,
          configuration: configuration.ok ? configuration.value : null,
          configurationError: configuration.ok ? null : configuration.error,
          relay: relay.snapshot(),
        };
      }),
      listWindowsCertificates: () => result(() => listWindowsCertificates()),
      loadConfiguration: ({ directory }) => result(() => readConfiguration(directory)),
      saveConfiguration: ({ directory, revision, bindings }) => mutate(async () => {
        requireStopped();
        return saveConfiguration(directory, revision, bindings);
      }),
      saveSettings: (input) => mutate(async () => {
        requireStopped();
        settings = await store.save(input);
        settingsError = null;
        return settings;
      }),
      startRelay: (secrets) => mutate(async () => relay.start(
        settings, await readConfiguration(settings.configDirectory), secrets,
      )),
      stopRelay: () => mutate(() => relay.stop()),
      clearLogs: () => mutate(() => relay.clearLogs()),
    },
    messages: {},
  },
});

const window = new BrowserWindow({
  title: "CAC SSL Relay",
  url: "views://mainview/index.html",
  navigationRules: JSON.stringify(["^*", "views://mainview/*"]),
  frame: { x: 120, y: 100, width: 1180, height: 850 },
  rpc,
});

let releaseWindowIcon = () => {};
if (process.platform === "win32") {
  try { releaseWindowIcon = installWindowsWindowIcon(window.ptr, join(PATHS.RESOURCES_FOLDER, "app.ico")); }
  catch (error) { console.warn("Could not apply the Windows window icon:", error); }
}

let quitApproved = false;
let shutdown: Promise<void> | null = null;
function stopAndQuit(): void {
  if (shutdown) return;
  closing = true;
  shutdown = (async () => {
    await operations;
    await relay.stop();
    releaseWindowIcon();
    quitApproved = true;
    Utils.quit();
  })();
}

Electrobun.events.on("before-quit", (event: ElectrobunEvent<{}, { allow: boolean }>) => {
  if (quitApproved) return;
  event.response = { allow: false };
  stopAndQuit();
});
window.on("close", stopAndQuit);
process.on("SIGINT", stopAndQuit);
process.on("SIGTERM", stopAndQuit);
