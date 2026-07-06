import { execFile } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { isNpxInstall } from "./invocation.js";

export { isNpxInstall };

/**
 * Reads/writes Claude Desktop's config so self-hosters never touch JSON by
 * hand — `saldo connect-claude` registers the connector's stdio MCP server.
 * (The Mac app has its own variant that registers an mcp-remote entry pointing
 * at the app's HTTP server; this one launches the headless connector directly.)
 */

const SERVER_KEY = "saldo";

interface ClaudeConfig {
  mcpServers?: Record<string, unknown>;
  [key: string]: unknown;
}

/** Claude Desktop's config file, per platform. */
export function claudeConfigPath(): string {
  const file = "claude_desktop_config.json";
  switch (process.platform) {
    case "darwin":
      return join(homedir(), "Library", "Application Support", "Claude", file);
    case "win32":
      return join(process.env.APPDATA ?? join(homedir(), "AppData", "Roaming"), "Claude", file);
    default:
      return join(process.env.XDG_CONFIG_HOME ?? join(homedir(), ".config"), "Claude", file);
  }
}

/** Absolute path to the connector's stdio entry (dist/index.js). */
export function stdioServerPath(): string {
  return resolve(dirname(fileURLToPath(import.meta.url)), "..", "index.js");
}

/** The npx binary that ships alongside the node running us — an absolute path,
 *  because GUI-launched MCP clients spawn servers with a minimal PATH. */
function npxBinPath(): string {
  return join(dirname(process.execPath), process.platform === "win32" ? "npx.cmd" : "npx");
}

function packageVersion(): string {
  const pkg = createRequire(import.meta.url)("../../package.json") as { version: string };
  return pkg.version;
}

async function readConfig(path: string): Promise<ClaudeConfig> {
  try {
    return JSON.parse(await readFile(path, "utf8")) as ClaudeConfig;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return {};
    throw new Error(
      `Claude config exists but is not valid JSON (${path}). Fix or remove it, then retry.`,
    );
  }
}

export async function isConnectedToClaude(path = claudeConfigPath()): Promise<boolean> {
  const config = await readConfig(path);
  return Boolean(config.mcpServers && SERVER_KEY in config.mcpServers);
}

/** Register (or update) the Saldo stdio server, preserving other entries.
 *
 * Two launch styles: a real install gets node + the installed script (works
 * offline, survives anything). Run via npx, we can't point at the cache (it
 * gets evicted), so the entry launches through npx itself, pinned to the
 * current version — npx re-fetches if the cache is gone. Re-run
 * connect-claude after upgrading to move the pin. */
export interface ServerEntry {
  command: string;
  args: string[];
  env?: Record<string, string>;
}

/** The launch entry both Claude Desktop and Claude Code register. */
export function serverEntry(viaNpx = isNpxInstall()): ServerEntry {
  const entry: ServerEntry = viaNpx
    ? { command: npxBinPath(), args: ["-y", `saldo-mcp@${packageVersion()}`, "serve"] }
    : { command: process.execPath, args: [stdioServerPath()] }; // the node running us — no PATH guessing
  // A custom data dir must follow the server into Claude's process.
  if (process.env.SALDO_DATA_DIR) entry.env = { SALDO_DATA_DIR: process.env.SALDO_DATA_DIR };
  return entry;
}

export async function connectToClaude(
  path = claudeConfigPath(),
  viaNpx = isNpxInstall(),
): Promise<{ path: string; restartRequired: true; viaNpx: boolean }> {
  const config = await readConfig(path);
  config.mcpServers = { ...(config.mcpServers ?? {}), [SERVER_KEY]: serverEntry(viaNpx) };
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, JSON.stringify(config, null, 2) + "\n", "utf8");
  return { path, restartRequired: true, viaNpx };
}

const exec = promisify(execFile);
// execFile can't spawn .cmd shims without a shell.
const CLAUDE_EXEC_OPTS = { shell: process.platform === "win32" } as const;

/** Args for `claude mcp add` that mirror a Desktop entry (exported for tests). */
export function claudeCodeAddArgs(entry: ServerEntry): string[] {
  const args = ["mcp", "add", "--scope", "user"];
  for (const [key, value] of Object.entries(entry.env ?? {})) args.push("--env", `${key}=${value}`);
  args.push(SERVER_KEY, "--", entry.command, ...entry.args);
  return args;
}

/**
 * Register the same server in Claude Code (the CLI), if it's installed.
 * Claude Code manages its own config, so we go through `claude mcp add`
 * rather than editing its files. Remove-then-add makes re-runs idempotent.
 */
export async function connectToClaudeCode(
  viaNpx = isNpxInstall(),
): Promise<"registered" | "not-installed"> {
  try {
    await exec("claude", ["--version"], CLAUDE_EXEC_OPTS);
  } catch {
    return "not-installed";
  }
  await exec("claude", ["mcp", "remove", "--scope", "user", SERVER_KEY], CLAUDE_EXEC_OPTS).catch(
    () => {}, // not registered yet — fine
  );
  await exec("claude", claudeCodeAddArgs(serverEntry(viaNpx)), CLAUDE_EXEC_OPTS);
  return "registered";
}

export async function disconnectFromClaudeCode(): Promise<void> {
  await exec("claude", ["mcp", "remove", "--scope", "user", SERVER_KEY], CLAUDE_EXEC_OPTS).catch(
    () => {}, // claude missing or not registered — nothing to remove
  );
}

export async function disconnectFromClaude(path = claudeConfigPath()): Promise<void> {
  const config = await readConfig(path);
  if (config.mcpServers && SERVER_KEY in config.mcpServers) {
    delete config.mcpServers[SERVER_KEY];
    await writeFile(path, JSON.stringify(config, null, 2) + "\n", "utf8");
  }
}
