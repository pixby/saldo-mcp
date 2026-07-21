# saldo-mcp

[![npm](https://img.shields.io/npm/v/saldo-mcp)](https://www.npmjs.com/package/saldo-mcp)

**Ask your AI about your money — without your money data ever leaving your machine.**

`saldo-mcp` is the open-source engine behind [Saldo](https://saldo.sh): a read-only
[MCP](https://modelcontextprotocol.io) server that connects Swedish/Nordic bank
accounts to Claude, ChatGPT, and any MCP-compatible assistant. It runs on **your**
computer, fetches data **directly** from the bank via [Enable Banking](https://enablebanking.com)'s
open-banking API, and keeps an **encrypted local cache** — so your transaction
history accumulates beyond the bank's ~90-day window, and nothing financial ever
touches anyone else's servers. Including ours.

## Principles

- **Read-only, always.** Account-information consents only. Payment initiation
  isn't a disabled feature — it's a capability this codebase does not contain.
- **Privacy by architecture.** The engine calls the bank API from your device.
  The optional managed broker (hosted by us, for the [paid tiers](https://saldo.sh/pricing.html))
  handles consent and short-lived keys only; it has no endpoint that can receive
  financial data.
- **Yours to run.** Self-hosting with your own free Enable Banking application is
  free forever, no account with us required.

## Quick start (self-host)

Requirements: Node 24+, a Swedish/Nordic bank account, and a free
[Enable Banking](https://enablebanking.com) application (their *Restricted
Production* tier: link your own accounts, real data, no contract).

No install needed to try it — state lives in `~/.saldo/`, not in the package:

```bash
npx saldo-mcp init                    # wizard: managed or self-host (paste your EB app id + .pem path)
npx saldo-mcp institutions SE
npx saldo-mcp link "SE:Your Bank"     # BankID in the browser
npx saldo-mcp sync                    # pull history into the encrypted cache
npx saldo-mcp doctor                  # ✓/✗ health checks
```

```bash
npx saldo-mcp connect-claude          # register in Claude Desktop, restart Claude
```

`connect-claude` registers the server in **Claude Desktop** (writes its
config) and in **Claude Code** (via `claude mcp add`, if the CLI is
installed) — launched via npx, absolute path, pinned to the current version;
re-run it after upgrades. Prefer a fixed install? `npm install -g saldo-mcp`
gives you the `saldo` command and pins Claude to that install instead.

Prefer running from source? `git clone https://github.com/pixby/saldo-mcp.git && cd saldo-mcp && npm install && npm run build`, then use `node dist/cli/index.js` in place of `saldo`.

Then ask Claude: *"What did I spend on groceries last month?"*

### Transaction labeling

`spending_by_category` gets real categories (Groceries, Dining, Transport, …)
from **your own assistant**: ask it to *"label my transactions"* (or run the
`label-transactions` MCP prompt) and it reads the unlabeled descriptions,
classifies them itself, and saves the labels through `set_transaction_labels` —
the one write tool on the surface, which can only store category labels in the
local encrypted cache and can never touch your bank. No API key, no extra
service, no data flow that didn't already exist. Unlabeled spending simply
shows as "Uncategorized" until then.

## Uninstall

Everything lives on your machine — removal is ordinary file deletion:

```bash
npx saldo-mcp disconnect-claude   # unregister from Claude Desktop + Claude Code
rm -rf ~/.saldo                   # config, encrypted cache + key
npm uninstall -g saldo-mcp        # if you installed globally
```

Bank consents live at your bank (revoke in Enable Banking's control panel;
they also expire on their own after ~180 days).

## MCP tools

Designed so assistants answer cheaply from pre-computed summaries instead of
re-deriving totals from raw dumps. Read-only toward your bank, always:

`list_accounts` · `get_balances` · `get_transactions` (date + amount filters,
one or all accounts) · `search_transactions` (full-text) ·
`spending_by_category` (categories from the labeling above, or by exact
counterparty) · `get_recurring_charges` · `compare_periods` ·
`get_unlabeled_transactions` + `set_transaction_labels` (the labeling pair —
the only write, local category labels only)

## Architecture notes

- **Provider-neutral core**: everything above `src/providers/provider.ts`
  (`BankProvider`) speaks provider-neutral domain types — Enable Banking is the
  backend today; others can slot in without touching the engine or tools.
- **Cache**: `node:sqlite` + AES-256-GCM at rest (no native deps). Only ids and
  booking dates are stored in the clear (for indexed range queries); amounts,
  names, and descriptions never hit disk unencrypted.
- **Transports**: stdio (this repo's default — your MCP client launches it) and
  Streamable HTTP on `127.0.0.1` (used by the Saldo desktop app).
- **Money** is integer minor units (öre) internally; formatting to kr happens
  only at presentation.
- **Tests**: `npm test` — integration/unit tests over a deterministic fake
  provider (no bank, no network, no secrets).

## Relationship to Saldo

This repo is the engine. [Saldo](https://saldo.sh) wraps it in a desktop app
(macOS/Windows/Linux) with one-click assistant connections and a managed tier
where you bring only your BankID. Self-hosting this engine is and stays free.

## License

[MIT](LICENSE) © Pixby Media AB
