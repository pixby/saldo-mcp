import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { loadConfig, type Config } from "./config.js";
import { Cache } from "./cache/cache.js";
import { Engine } from "./engine.js";
import { StateStore } from "./state.js";
import { BrokerClient } from "./broker-client.js";
import { EnableBankingProvider } from "./providers/enablebanking/index.js";
import { localTokenProvider } from "./providers/enablebanking/token.js";
import type { ConsentStrategy } from "./consent/consent.js";
import { SelfHostConsent } from "./consent/self-host.js";
import { ManagedConsent } from "./consent/managed.js";

/**
 * Load connector/.env (next to package.json) if present, so the CLI and stdio
 * MCP server pick up credentials without exporting them in the shell.
 */
function loadDotEnv(): void {
  try {
    process.loadEnvFile(fileURLToPath(new URL("../.env", import.meta.url)));
  } catch {
    /* no .env file, or already provided via the environment */
  }
}

/** Build the data provider + consent strategy for the configured mode. */
async function buildMode(
  config: Config,
  state: StateStore,
): Promise<{ provider: EnableBankingProvider; consent: ConsentStrategy }> {
  if (config.mode === "managed") {
    const broker = new BrokerClient(config.brokerUrl!, config.dataDir);
    await broker.ensureDevice();
    const provider = new EnableBankingProvider({ getToken: (force) => broker.getToken(force) });
    return { provider, consent: new ManagedConsent(broker) };
  }
  const { applicationId, privateKey } = config.enablebanking!;
  const provider = new EnableBankingProvider({
    getToken: localTokenProvider(applicationId, privateKey),
  });
  return { provider, consent: new SelfHostConsent(provider, state, config.redirectUrl) };
}

/** Wire config -> mode (provider + consent) -> cache -> engine. */
export async function createEngine(): Promise<Engine> {
  loadDotEnv();
  const config = loadConfig();
  const state = new StateStore(config.dataDir);
  await state.load();

  const { provider, consent } = await buildMode(config, state);

  // The cache is best-effort: if node:sqlite is unavailable, fall back to live calls.
  let cache: Cache | undefined;
  try {
    cache = await Cache.open(join(config.dataDir, "cache.sqlite"), config.dataDir);
  } catch (err) {
    console.error(
      "[saldo] local cache unavailable, using live provider calls:",
      err instanceof Error ? err.message : err,
    );
  }

  return new Engine(provider, consent, cache);
}
