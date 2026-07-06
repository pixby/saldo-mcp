import { sep } from "node:path";
import { fileURLToPath } from "node:url";

/** True when this code runs out of the npx cache rather than a real install. */
export function isNpxInstall(): boolean {
  return fileURLToPath(import.meta.url).includes(`${sep}_npx${sep}`);
}

/**
 * How the user invokes us. Command hints ("run: … init") must match the way
 * the CLI is actually being run: via npx there is no `saldo` on PATH.
 */
export const CLI = isNpxInstall() ? "npx saldo-mcp" : "saldo";
