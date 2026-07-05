import { mkdir, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

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

/** Register (or update) the Saldo stdio server, preserving other entries. */
export async function connectToClaude(
  path = claudeConfigPath(),
): Promise<{ path: string; restartRequired: true }> {
  const config = await readConfig(path);
  const entry: { command: string; args: string[]; env?: Record<string, string> } = {
    command: process.execPath, // the node that's running us — no PATH guessing
    args: [stdioServerPath()],
  };
  // A custom data dir must follow the server into Claude's process.
  if (process.env.SALDO_DATA_DIR) entry.env = { SALDO_DATA_DIR: process.env.SALDO_DATA_DIR };
  config.mcpServers = { ...(config.mcpServers ?? {}), [SERVER_KEY]: entry };
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, JSON.stringify(config, null, 2) + "\n", "utf8");
  return { path, restartRequired: true };
}

export async function disconnectFromClaude(path = claudeConfigPath()): Promise<void> {
  const config = await readConfig(path);
  if (config.mcpServers && SERVER_KEY in config.mcpServers) {
    delete config.mcpServers[SERVER_KEY];
    await writeFile(path, JSON.stringify(config, null, 2) + "\n", "utf8");
  }
}
