#!/usr/bin/env node
import { createEngine } from "../bootstrap.js";
import { CLI } from "../util/invocation.js";
import { formatMoney } from "../util/money.js";
import { balanceTypeLabel } from "../util/balance.js";
import { runInit } from "./init.js";
import { runDoctor } from "./doctor.js";
import {
  connectToClaude,
  connectToClaudeCode,
  disconnectFromClaude,
  disconnectFromClaudeCode,
} from "../util/claude-config.js";

/**
 * Setup CLI for the headless connector. Drives the bank-link (consent) flow and
 * some quick read commands for verifying a connection outside an MCP client.
 *
 *   saldo institutions [SE]        list banks in a country
 *   saldo link "<institutionId>"   open the bank auth URL, capture the callback
 *   saldo status                   show connected accounts + balances
 *   saldo sync                     pull latest transactions into the local cache
 */
const usageLine = (cmd: string, desc: string) =>
  `  ${`${CLI} ${cmd}`.padEnd(CLI.length + 24)}${desc}`;
const USAGE = [
  "Saldo connector CLI",
  "",
  usageLine("init", "set up Saldo (managed or self-host) — start here"),
  usageLine("institutions [SE]", "list banks in a country"),
  usageLine("link <institutionId>", "connect a bank (BankID)"),
  usageLine("status", "show connected accounts + balances"),
  usageLine("sync", "pull latest transactions into the local cache"),
  usageLine("sessions", "list bank connections + consent expiry"),
  usageLine("disconnect <id>", "disconnect a bank connection (revokes consent)"),
  usageLine("serve", "run the MCP server on stdio (what Claude launches)"),
  usageLine("connect-claude", "register Saldo in Claude Desktop + Claude Code"),
  usageLine("disconnect-claude", "remove Saldo from Claude Desktop + Claude Code"),
  usageLine("doctor", "check config, provider, cache, Claude setup"),
  "",
  "Start the MCP server with: npm start",
].join("\n");

async function main(): Promise<void> {
  const [command, arg] = process.argv.slice(2);

  // These need no engine (and init needs no credentials at all).
  switch (command) {
    case "init":
      return runInit(process.argv.slice(3));
    case "doctor":
      return runDoctor();
    case "serve":
      // Same stdio MCP server as running dist/index.js directly — this is what
      // an npx-style Claude Desktop entry launches.
      await import("../index.js");
      return new Promise(() => {}); // stays up until the MCP client closes us
    case "connect-claude": {
      const result = await connectToClaude();
      console.log(`✓ Registered Saldo in Claude Desktop (${result.path}).`);
      if ((await connectToClaudeCode()) === "registered") {
        console.log("✓ Registered Saldo in Claude Code (user scope).");
      } else {
        console.log(`· Claude Code not detected — to add it later: claude mcp add saldo -- ${CLI === "saldo" ? "saldo" : "npx -y saldo-mcp"} serve`);
      }
      if (result.viaNpx) {
        console.log("Claude launches Saldo via npx, pinned to this version — re-run connect-claude after upgrades.");
      }
      console.log("Restart Claude Desktop (or open a new Claude Code session), then ask about your spending.");
      return;
    }
    case "disconnect-claude":
      await disconnectFromClaude();
      await disconnectFromClaudeCode();
      console.log("Removed Saldo from Claude Desktop and Claude Code.");
      return;
  }

  // Help needs no credentials — handle it before building the engine.
  const commands = ["institutions", "link", "status", "sync", "sessions", "disconnect"];
  if (!command || !commands.includes(command)) {
    console.log(USAGE);
    return;
  }

  const engine = await createEngine();

  switch (command) {
    case "sync": {
      if (!engine.cacheEnabled) {
        console.log("Local cache is not available; nothing to sync.");
        return;
      }
      console.log("Syncing…");
      const result = await engine.sync();
      console.log(
        `Synced ${result.transactions} transaction(s) across ${result.accounts} account(s) into the local cache.`,
      );
      break;
    }

    case "institutions": {
      const institutions = await engine.listInstitutions(arg ?? "SE");
      for (const inst of institutions) {
        console.log(`${inst.id}\t${inst.name}${inst.bic ? ` (${inst.bic})` : ""}`);
      }
      console.log(`\n${institutions.length} institutions. Use an id with: ${CLI} link <id>`);
      break;
    }

    case "link": {
      if (!arg) {
        throw new Error(`Usage: ${CLI} link "<institutionId>"  (see: ${CLI} institutions)`);
      }
      const result = await engine.link(arg, (url) => {
        console.log("\nOpen this URL and authenticate with your bank (BankID):\n");
        console.log(`  ${url}\n`);
        console.log("Waiting for you to finish in the browser… (Ctrl-C to cancel)\n");
      });
      console.log(`Linked! ${result.accountIds.length} account(s) connected.`);
      break;
    }

    case "status": {
      const accounts = await engine.listAccounts();
      if (!accounts.length) {
        console.log(`No accounts connected. Start with: ${CLI} link <institutionId>`);
        return;
      }
      for (const account of accounts) {
        console.log(`\n${account.name ?? "Account"} (${account.id})`);
        if (account.iban) console.log(`  IBAN: ${account.iban}`);
        const balances = await engine.getBalances(account.id);
        for (const b of balances) console.log(`  ${balanceTypeLabel(b.type)}: ${formatMoney(b.amount)}`);
      }
      const expiring = (await engine.consentStatus()).filter((s) => s.expiringSoon);
      for (const s of expiring) {
        const when = s.daysLeft === undefined ? "" : s.daysLeft < 0 ? " (expired)" : ` (${s.daysLeft} days left)`;
        console.log(`\n⚠ Consent for ${s.institutionId} needs renewal${when} — run: ${CLI} link "${s.institutionId}"`);
      }
      break;
    }

    case "sessions": {
      const sessions = await engine.listSessions();
      if (!sessions.length) {
        console.log(`No bank connections. Start with: ${CLI} link <institutionId>`);
        return;
      }
      for (const s of sessions) {
        const exp = s.validUntil ? `expires ${s.validUntil.slice(0, 10)}` : "no expiry info";
        console.log(`${s.sessionId}\t${s.institutionId}\t${s.accountIds.length} account(s)\t${exp}`);
      }
      console.log(`\nDisconnect one with: ${CLI} disconnect <id>`);
      break;
    }

    case "disconnect": {
      if (!arg) throw new Error(`Usage: ${CLI} disconnect <sessionId>  (see: ${CLI} sessions)`);
      await engine.disconnect(arg);
      console.log(`Disconnected ${arg}. Consent revoked; its accounts are no longer accessible.`);
      break;
    }
  }
}

main().catch((err) => {
  console.error("Error:", err instanceof Error ? err.message : err);
  process.exit(1);
});
