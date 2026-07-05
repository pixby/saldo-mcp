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

To connect an assistant, install permanently (Claude Desktop launches the
server from a fixed path, and the npx cache is temporary):

```bash
npm install -g saldo-mcp
saldo connect-claude                  # register in Claude Desktop, restart Claude
```

Prefer running from source? `git clone https://github.com/pixby/saldo-mcp.git && cd saldo-mcp && npm install && npm run build`, then use `node dist/cli/index.js` in place of `saldo`.

Then ask Claude: *"What did I spend on groceries last month?"*

(npm package coming: `npx saldo-mcp init` — after which the command is just `saldo`.)

## MCP tools

Seven read-only tools, designed so assistants answer cheaply from pre-computed
summaries instead of re-deriving totals from raw dumps:

`list_accounts` · `get_balances` · `get_transactions` (date + amount filters,
one or all accounts) · `search_transactions` (full-text) ·
`spending_by_category` (own Nordic merchant categorizer, or by exact counterparty) ·
`get_recurring_charges` · `compare_periods`

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
- **Tests**: `npm test` — 54 integration/unit tests over a deterministic fake
  provider (no bank, no network, no secrets).

## Relationship to Saldo

This repo is the engine. [Saldo](https://saldo.sh) wraps it in a desktop app
(macOS/Windows/Linux) with one-click assistant connections and a managed tier
where you bring only your BankID. Self-hosting this engine is and stays free.

## License

[MIT](LICENSE) © Pixby Media AB
