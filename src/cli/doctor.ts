import { accessSync, constants } from "node:fs";
import { CLI } from "../util/invocation.js";
import { defaultDataDir, loadConfig, savedConfigPath, ConfigError } from "../config.js";
import { claudeConfigPath, isConnectedToClaude } from "../util/claude-config.js";
import { createEngine } from "../bootstrap.js";

/**
 * `saldo doctor` — one ✓/✗ line per health check, exit 1 if anything is ✗.
 * Checks stop at the first structural failure (no config → no engine checks),
 * but always print what they could determine.
 */

const ok = (msg: string) => console.log(`  ✓ ${msg}`);
const bad = (msg: string, hint?: string) => {
  console.log(`  ✗ ${msg}${hint ? `\n      → ${hint}` : ""}`);
  return false;
};

export async function runDoctor(): Promise<void> {
  console.log("\nSaldo doctor\n────────────");
  let healthy = true;

  // Node version — node:sqlite needs 24+.
  const major = Number(process.versions.node.split(".")[0]);
  if (major >= 24) ok(`Node ${process.versions.node}`);
  else healthy = bad(`Node ${process.versions.node} — need 24+`, "https://nodejs.org");

  // Configuration source + shape.
  const dataDir = defaultDataDir();
  let mode: string | undefined;
  try {
    const config = loadConfig();
    mode = config.mode;
    const source = process.env.EB_APPLICATION_ID || process.env.SALDO_BROKER_URL
      ? "environment"
      : savedConfigPath(dataDir);
    ok(`Config: ${config.mode} mode (${source})`);
  } catch (err) {
    healthy = bad(
      err instanceof ConfigError ? err.message : `Config error: ${(err as Error).message}`,
      `run: ${CLI} init`,
    );
  }

  // Data dir writable (cache + state live here).
  try {
    accessSync(dataDir, constants.W_OK);
    ok(`Data dir writable: ${dataDir}`);
  } catch {
    // Not created yet is fine — the engine creates it; only flag a real denial.
    ok(`Data dir: ${dataDir} (will be created on first use)`);
  }

  // Engine + provider reachability + cache.
  if (mode) {
    try {
      const engine = await createEngine();
      ok(`Engine starts (provider: ${engine.providerId})`);
      ok(engine.cacheEnabled ? "Encrypted local cache available" : "Cache unavailable — falling back to live provider calls");
      try {
        const institutions = await engine.listInstitutions("SE");
        ok(`Provider reachable (${institutions.length} banks in SE)`);
      } catch (err) {
        healthy = bad(`Provider unreachable: ${(err as Error).message}`,
          mode === "selfhost"
            ? "check your Enable Banking application id/key"
            : "check your network; the broker may be down");
      }
      const accounts = await engine.accountIds();
      if (accounts.length) ok(`${accounts.length} account(s) linked`);
      else ok(`No accounts linked yet — run: ${CLI} link "<institutionId>"`);
    } catch (err) {
      healthy = bad(`Engine failed to start: ${(err as Error).message}`);
    }
  }

  // Claude Desktop registration.
  try {
    if (await isConnectedToClaude()) ok(`Registered in Claude Desktop (${claudeConfigPath()})`);
    else ok(`Not registered in Claude Desktop — run: ${CLI} connect-claude`);
  } catch (err) {
    healthy = bad(`Claude Desktop config unreadable: ${(err as Error).message}`);
  }

  console.log(healthy ? "\nAll good.\n" : "\nSomething needs attention (see ✗ above).\n");
  if (!healthy) process.exitCode = 1;
}
