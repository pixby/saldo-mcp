import { homedir } from "node:os";
import { join } from "node:path";
import { readFileSync } from "node:fs";
import { CLI } from "./util/invocation.js";

/**
 * Runtime configuration. Environment variables win; when they're absent we fall
 * back to `<dataDir>/config.json` — the file both the Mac app's Settings screen
 * and `saldo init` write. Keep this the single place that touches process.env
 * and that file, so the rest of the code stays testable and provider-neutral.
 *
 * Mode is inferred: SALDO_BROKER_URL (env or file) → managed (the broker holds
 * the Enable Banking key); otherwise → self-host (bring your own EB application).
 */

export type Mode = "selfhost" | "managed";

export interface Config {
  mode: Mode;
  dataDir: string;
  /** Loopback callback for self-host consent (managed consent uses the broker). */
  redirectUrl: string;
  /** Present in self-host mode. */
  enablebanking?: { applicationId: string; privateKey: string };
  /** Present in managed mode. */
  brokerUrl?: string;
}

export class ConfigError extends Error {}

/** Shape of `<dataDir>/config.json` — written by the app's Settings screen and
 *  by `saldo init`. */
export interface SavedConfig {
  mode: Mode;
  applicationId?: string;
  privateKey?: string;
  redirectUrl?: string;
  brokerUrl?: string;
}

// A `\n`-escaped single-line PEM — convenient in a .env or JSON config — is
// un-escaped; a real multi-line PEM has no `\n` literals and passes through.
const unescapePem = (pem: string) => pem.replace(/\\n/g, "\n");

export function defaultDataDir(): string {
  return process.env.SALDO_DATA_DIR ?? join(homedir(), ".saldo");
}

export function savedConfigPath(dataDir: string): string {
  return join(dataDir, "config.json");
}

export function readSavedConfig(dataDir: string): SavedConfig | undefined {
  try {
    return JSON.parse(readFileSync(savedConfigPath(dataDir), "utf8")) as SavedConfig;
  } catch {
    return undefined;
  }
}

export function loadConfig(): Config {
  const dataDir = defaultDataDir();
  const saved = readSavedConfig(dataDir);
  const redirectUrl =
    process.env.EB_REDIRECT_URL ?? saved?.redirectUrl ?? "https://localhost:8888/callback";

  // Environment wins; the saved file fills in when env is absent.
  const brokerUrl =
    process.env.SALDO_BROKER_URL ?? (saved?.mode === "managed" ? saved.brokerUrl : undefined);
  if (brokerUrl && !process.env.EB_APPLICATION_ID) {
    return { mode: "managed", dataDir, redirectUrl, brokerUrl };
  }

  const applicationId =
    process.env.EB_APPLICATION_ID ??
    (saved?.mode === "selfhost" ? saved.applicationId : undefined);
  const privateKey =
    process.env.EB_PRIVATE_KEY ?? (saved?.mode === "selfhost" ? saved.privateKey : undefined);
  if (!applicationId || !privateKey) {
    throw new ConfigError(
      `No configuration found. Run \`${CLI} init\` (writes ~/.saldo/config.json), or set ` +
        "EB_APPLICATION_ID + EB_PRIVATE_KEY (self-host) / SALDO_BROKER_URL (managed) in the environment.",
    );
  }
  return {
    mode: "selfhost",
    dataDir,
    redirectUrl,
    enablebanking: { applicationId, privateKey: unescapePem(privateKey) },
  };
}
