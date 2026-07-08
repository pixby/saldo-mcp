import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { Engine } from "../engine.js";
import type { Transaction } from "../domain/types.js";
import { formatMinor, formatMoney } from "../util/money.js";
import { balanceTypeLabel } from "../util/balance.js";
import {
  getRecurringCharges,
  spendingByCategory,
  summarizePeriod,
} from "../summary.js";

/** Fired after an MCP tool call completes. Carries call metadata only — never
 *  tool arguments or results — so a subscriber (a UI activity feed, a log)
 *  can show *that* something was asked without ever seeing *what*. */
export interface ToolCallEvent {
  tool: string;
  /** MCP client name from the initialize handshake, when the transport knows it. */
  client?: string;
  /** ISO 8601 timestamp of when the call started. */
  startedAt: string;
  durationMs: number;
  /** False when the tool handler threw (the client sees an isError result). */
  ok: boolean;
}

export interface McpServerOptions {
  /** Observability hook, invoked once per tool call. Exceptions it throws are
   *  swallowed — a broken observer must never fail a tool call. */
  onToolCall?: (event: ToolCallEvent) => void;
}

/**
 * Read-only MCP surface. Every tool is a query; nothing here can move money or
 * mutate bank state. Tools return compact, pre-computed text so assistants can
 * answer cheaply without re-deriving totals from raw dumps.
 */
export function buildMcpServer(engine: Engine, options: McpServerOptions = {}): McpServer {
  const server = new McpServer({ name: "saldo-connector", version: "0.1.0" });

  const text = (value: string) => ({ content: [{ type: "text" as const, text: value }] });
  type ToolResult = ReturnType<typeof text>;

  /** Wrap a tool handler so onToolCall fires with metadata after each call. */
  const instrument = <Args extends unknown[]>(
    name: string,
    handler: (...args: Args) => Promise<ToolResult>,
  ) => {
    if (!options.onToolCall) return handler;
    return async (...args: Args): Promise<ToolResult> => {
      const started = Date.now();
      let ok = false;
      try {
        const result = await handler(...args);
        ok = true;
        return result;
      } finally {
        try {
          options.onToolCall?.({
            tool: name,
            client: server.server.getClientVersion()?.name,
            startedAt: new Date(started).toISOString(),
            durationMs: Date.now() - started,
            ok,
          });
        } catch {
          // observer errors never break tool calls
        }
      }
    };
  };

  server.tool(
    "list_accounts",
    "List the bank accounts the user has connected.",
    instrument("list_accounts", async () => {
      const accounts = await engine.listAccounts();
      if (!accounts.length) {
        return text("No accounts connected yet. Run `saldo link <institutionId>` first.");
      }
      const lines = accounts.map((a) =>
        `- ${a.name ?? "Account"} (${a.id})${a.iban ? ` · ${a.iban}` : ""}${a.currency ? ` · ${a.currency}` : ""}`,
      );
      return text(lines.join("\n"));
    }),
  );

  server.tool(
    "get_balances",
    "Get current balances. Omit `account` for all connected accounts.",
    { account: z.string().optional().describe("Account id; all accounts if omitted") },
    instrument("get_balances", async ({ account }) => {
      const balances = await engine.getBalances(account);
      if (!balances.length) return text("No balances available.");
      const lines = balances.map((b) =>
        `- ${b.accountId} · ${balanceTypeLabel(b.type)}: ${formatMoney(b.amount)}${b.referenceDate ? ` (as of ${b.referenceDate})` : ""}`,
      );
      return text(lines.join("\n"));
    }),
  );

  const txLine = (t: Transaction) =>
    `${t.bookedAt ?? "pending"} · ${formatMoney(t.amount)} · ${t.counterparty ?? t.description ?? "—"}${t.status === "pending" ? " [pending]" : ""}`;

  server.tool(
    "get_transactions",
    "List transactions within an optional date range. Omit `account` for all connected accounts; filter by absolute amount in kr with min_amount/max_amount.",
    {
      account: z.string().optional().describe("Account id; all accounts if omitted"),
      from: z.string().optional().describe("Start date YYYY-MM-DD (inclusive)"),
      to: z.string().optional().describe("End date YYYY-MM-DD (inclusive)"),
      min_amount: z.number().optional().describe("Only transactions of at least this many kr (absolute value)"),
      max_amount: z.number().optional().describe("Only transactions of at most this many kr (absolute value)"),
    },
    instrument("get_transactions", async ({ account, from, to, min_amount, max_amount }) => {
      let txs = account
        ? await engine.getTransactions(account, from, to)
        : await engine.getAllTransactions(from, to);
      if (min_amount !== undefined) {
        const min = Math.round(min_amount * 100);
        txs = txs.filter((t) => Math.abs(t.amount.amountMinor) >= min);
      }
      if (max_amount !== undefined) {
        const max = Math.round(max_amount * 100);
        txs = txs.filter((t) => Math.abs(t.amount.amountMinor) <= max);
      }
      if (!txs.length) return text("No transactions match.");
      return text(txs.map(txLine).join("\n"));
    }),
  );

  server.tool(
    "search_transactions",
    "Full-text search over transaction counterparties and descriptions (case-insensitive).",
    {
      query: z.string().describe("Text to search for, e.g. a merchant name"),
      account: z.string().optional().describe("Account id; all accounts if omitted"),
      from: z.string().optional().describe("Start date YYYY-MM-DD (inclusive)"),
      to: z.string().optional().describe("End date YYYY-MM-DD (inclusive)"),
    },
    instrument("search_transactions", async ({ query, account, from, to }) => {
      const txs = account
        ? await engine.getTransactions(account, from, to)
        : await engine.getAllTransactions(from, to);
      const needle = query.trim().toLowerCase();
      if (!needle) return text("Empty search query.");
      const hits = txs.filter((t) =>
        `${t.counterparty ?? ""} ${t.description ?? ""}`.toLowerCase().includes(needle),
      );
      if (!hits.length) return text(`No transactions matching "${query}".`);
      return text(hits.map(txLine).join("\n"));
    }),
  );

  server.tool(
    "spending_by_category",
    "Summarize spending over a period, grouped by category (default) or exact counterparty.",
    {
      period: z
        .string()
        .optional()
        .describe("YYYY (year) or YYYY-MM (month). Defaults to the last 90 days."),
      group_by: z
        .enum(["category", "counterparty"])
        .optional()
        .describe("Group by derived category (default) or exact counterparty/merchant"),
    },
    instrument("spending_by_category", async ({ period, group_by }) => {
      const { from, to } = periodToRange(period);
      const txs = await engine.getAllTransactions(from, to);
      const summary = spendingByCategory(txs, group_by ?? "category");
      if (!summary.length) return text("No spending in that period.");
      const lines = summary.map((s) =>
        `- ${s.category}: ${formatMinor(s.spentMinor, s.currency)} (${s.transactionCount}×)`,
      );
      return text(lines.join("\n"));
    }),
  );

  server.tool(
    "get_recurring_charges",
    "Detect likely recurring charges (subscriptions, rent) across connected accounts.",
    instrument("get_recurring_charges", async () => {
      const txs = await engine.getAllTransactions();
      const recurring = getRecurringCharges(txs);
      if (!recurring.length) return text("No recurring charges detected.");
      const lines = recurring.map((r) =>
        `- ${r.counterparty}: ~${formatMinor(r.typicalAmountMinor, r.currency)} · ${r.occurrences}× over ${r.months.length} months`,
      );
      return text(lines.join("\n"));
    }),
  );

  server.tool(
    "compare_periods",
    "Compare spending/income between two periods (YYYY or YYYY-MM).",
    {
      a: z.string().describe("First period, YYYY or YYYY-MM"),
      b: z.string().describe("Second period, YYYY or YYYY-MM"),
    },
    instrument("compare_periods", async ({ a, b }) => {
      const ra = periodToRange(a);
      const rb = periodToRange(b);
      const [txsA, txsB] = await Promise.all([
        engine.getAllTransactions(ra.from, ra.to),
        engine.getAllTransactions(rb.from, rb.to),
      ]);
      const sa = summarizePeriod(txsA);
      const sb = summarizePeriod(txsB);
      const cur = sa.currency || sb.currency;
      const out = [
        `${a}: spent ${formatMinor(sa.spentMinor, cur)}, received ${formatMinor(sa.receivedMinor, cur)}, net ${formatMinor(sa.netMinor, cur)}`,
        `${b}: spent ${formatMinor(sb.spentMinor, cur)}, received ${formatMinor(sb.receivedMinor, cur)}, net ${formatMinor(sb.netMinor, cur)}`,
        `Δ spending: ${formatMinor(sb.spentMinor - sa.spentMinor, cur)}`,
      ];
      return text(out.join("\n"));
    }),
  );

  return server;
}

/** Convert a "YYYY" or "YYYY-MM" period (or nothing) into an ISO date range. */
function periodToRange(period?: string): { from?: string; to?: string } {
  if (!period) {
    const now = new Date();
    const to = now.toISOString().slice(0, 10);
    const fromDate = new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000);
    return { from: fromDate.toISOString().slice(0, 10), to };
  }
  if (/^\d{4}$/.test(period)) return { from: `${period}-01-01`, to: `${period}-12-31` };
  if (/^\d{4}-\d{2}$/.test(period)) {
    const [y, m] = period.split("-").map(Number);
    const lastDay = new Date(Date.UTC(y!, m!, 0)).getUTCDate();
    return { from: `${period}-01`, to: `${period}-${String(lastDay).padStart(2, "0")}` };
  }
  return {};
}
