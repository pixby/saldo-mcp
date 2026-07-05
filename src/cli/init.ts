import { createInterface } from "node:readline/promises";
import { stdin, stdout } from "node:process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import {
  defaultDataDir,
  readSavedConfig,
  savedConfigPath,
  type SavedConfig,
} from "../config.js";

/**
 * `saldo init` — the self-host onboarding wizard. Interactive by default;
 * scriptable with flags:
 *
 *   saldo init --managed [--broker-url URL] [--force]
 *   saldo init --selfhost --app-id ID --key <path-or-PEM> [--redirect URL] [--force]
 *
 * Writes <dataDir>/config.json (0600) — the same file the Mac app's Settings
 * screen uses, and the file loadConfig() falls back to when env is absent.
 */

const DEFAULT_BROKER_URL = "https://saldo-broker.up.railway.app";
const DEFAULT_REDIRECT = "https://localhost:8888/callback";

function flag(args: string[], name: string): string | undefined {
  const i = args.indexOf(`--${name}`);
  return i === -1 ? undefined : args[i + 1];
}

/** Accept a path to a .pem file or a pasted PEM (incl. \n-escaped one-liners). */
async function resolveKey(input: string): Promise<string> {
  const trimmed = input.trim();
  if (trimmed.includes("BEGIN") || trimmed.includes("\\n")) return trimmed;
  if (existsSync(trimmed)) return (await readFile(trimmed, "utf8")).trim();
  throw new Error(`"${trimmed}" is neither a PEM nor a readable file path.`);
}

export async function runInit(argv: string[]): Promise<void> {
  const dataDir = defaultDataDir();
  const configFile = savedConfigPath(dataDir);
  const force = argv.includes("--force");

  const existing = readSavedConfig(dataDir);
  const interactive = !argv.includes("--managed") && !argv.includes("--selfhost");

  let cfg: SavedConfig;

  if (!interactive) {
    if (existing && !force) {
      throw new Error(`${configFile} already exists — pass --force to overwrite.`);
    }
    if (argv.includes("--managed")) {
      cfg = { mode: "managed", brokerUrl: flag(argv, "broker-url") ?? DEFAULT_BROKER_URL };
    } else {
      const appId = flag(argv, "app-id");
      const key = flag(argv, "key");
      if (!appId || !key) throw new Error("--selfhost needs --app-id and --key <path-or-PEM>.");
      cfg = {
        mode: "selfhost",
        applicationId: appId,
        privateKey: await resolveKey(key),
        redirectUrl: flag(argv, "redirect") ?? DEFAULT_REDIRECT,
      };
    }
  } else {
    const rl = createInterface({ input: stdin, output: stdout });
    try {
      console.log("\nSaldo setup\n───────────");
      if (existing) {
        const answer = await rl.question(
          `A config already exists (${existing.mode}). Overwrite? [y/N] `,
        );
        if (!/^y(es)?$/i.test(answer.trim())) {
          console.log("Keeping the existing config. Nothing changed.");
          return;
        }
      }
      console.log(
        [
          "",
          "How should Saldo connect to your bank?",
          "",
          "  1) Managed   — the hosted Saldo broker. Just BankID, nothing to enter. (default)",
          "  2) Self-host — your own (free) Enable Banking application; keys stay with you.",
          "",
        ].join("\n"),
      );
      const mode = (await rl.question("Choose [1/2]: ")).trim();

      if (mode === "2") {
        console.log(
          [
            "",
            "You need a free Enable Banking application (Restricted Production tier):",
            "  enablebanking.com → control panel → Applications → register (Production,",
            '  key "generate in browser", redirect URL https://localhost:8888/callback),',
            "  then link your own bank accounts to it in the control panel.",
            "",
          ].join("\n"),
        );
        const appId = (await rl.question("Application ID (the .pem filename, no extension): ")).trim();
        if (!appId) throw new Error("Application ID is required.");
        const keyInput = await rl.question("Private key — path to the .pem file (or paste the PEM): ");
        const privateKey = await resolveKey(keyInput);
        const redirect =
          (await rl.question(`Redirect URL [${DEFAULT_REDIRECT}]: `)).trim() || DEFAULT_REDIRECT;
        cfg = { mode: "selfhost", applicationId: appId, privateKey, redirectUrl: redirect };
      } else {
        cfg = { mode: "managed", brokerUrl: DEFAULT_BROKER_URL };
      }
    } finally {
      rl.close();
    }
  }

  await mkdir(dataDir, { recursive: true });
  await writeFile(configFile, JSON.stringify(cfg, null, 2) + "\n", { mode: 0o600 });
  console.log(`\n✓ Wrote ${configFile} (${cfg.mode} mode)`);
  console.log(
    [
      "",
      "Next steps:",
      "  saldo institutions SE      find your bank",
      '  saldo link "SE:Your Bank"  connect it (BankID)',
      "  saldo connect-claude       register Saldo in Claude Desktop",
      "  saldo doctor               check that everything is healthy",
      "",
    ].join("\n"),
  );
}
