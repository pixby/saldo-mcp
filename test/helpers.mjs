import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Engine } from "../dist/engine.js";

/**
 * Shared test fixtures: a deterministic fake BankProvider + ConsentStrategy so
 * every layer above the provider interface (engine, cache, summaries, MCP
 * tools) can be tested without a bank, network, or secrets.
 */

export const CHECKING = "acc_checking";
export const SAVINGS = "acc_savings";

export const ACCOUNTS = [
  { id: CHECKING, name: "Lönekonto", iban: "SE3550000000054910000003", currency: "SEK" },
  { id: SAVINGS, name: "Sparkonto", currency: "SEK" },
];

export const BALANCES = {
  [CHECKING]: [
    {
      accountId: CHECKING,
      amount: { amountMinor: 1234567, currency: "SEK" },
      type: "interimAvailable",
      referenceDate: "2025-06-30",
    },
  ],
  [SAVINGS]: [
    {
      accountId: SAVINGS,
      amount: { amountMinor: 50000000, currency: "SEK" },
      type: "closingBooked",
      referenceDate: "2025-06-30",
    },
  ],
};

const tx = (id, accountId, bookedAt, amountMinor, counterparty, description, status = "booked") => ({
  id,
  accountId,
  bookedAt,
  amount: { amountMinor, currency: "SEK" },
  counterparty,
  description,
  status,
});

/** Apr–Jun 2025: monthly Spotify + rent, groceries, salary inflows. */
export const TRANSACTIONS = [
  tx("t01", CHECKING, "2025-04-01", -11900, "Spotify AB", "Spotify Premium"),
  tx("t02", CHECKING, "2025-05-01", -11900, "Spotify AB", "Spotify Premium"),
  tx("t03", CHECKING, "2025-06-01", -11900, "Spotify AB", "Spotify Premium"),
  tx("t04", CHECKING, "2025-04-03", -850000, "Wallenstam AB", "Hyra april"),
  tx("t05", CHECKING, "2025-05-03", -850000, "Wallenstam AB", "Hyra maj"),
  tx("t06", CHECKING, "2025-06-03", -850000, "Wallenstam AB", "Hyra juni"),
  tx("t07", CHECKING, "2025-06-10", -45210, "ICA Supermarket Aptiten", "Matinköp"),
  tx("t08", CHECKING, "2025-06-17", -61550, "ICA Supermarket Aptiten", "Matinköp"),
  tx("t09", CHECKING, "2025-06-24", -23085, "Coop Konsum", "Matinköp"),
  tx("t10", CHECKING, "2025-04-25", 3500000, "Arbetsgivaren AB", "Lön april"),
  tx("t11", CHECKING, "2025-05-25", 3500000, "Arbetsgivaren AB", "Lön maj"),
  tx("t12", CHECKING, "2025-06-25", 3500000, "Arbetsgivaren AB", "Lön juni"),
  tx("t13", SAVINGS, "2025-06-26", 100000, undefined, "Överföring sparande"),
  tx("t14", CHECKING, "2025-06-28", -19900, "SF Bio", "Filmstaden", "pending"),
];

/** ISO date n days before now — for tests that must fall inside the engine's
 *  rolling 90-day sync window. */
export function daysAgo(n) {
  return new Date(Date.now() - n * 86400_000).toISOString().slice(0, 10);
}

/** Fixture variant with recent dates, so Engine.sync() (which requests the
 *  last 90 days) actually picks them up. */
export function recentTransactions() {
  return [
    tx("r01", CHECKING, daysAgo(65), -11900, "Spotify AB", "Spotify Premium"),
    tx("r02", CHECKING, daysAgo(35), -11900, "Spotify AB", "Spotify Premium"),
    tx("r03", CHECKING, daysAgo(5), -11900, "Spotify AB", "Spotify Premium"),
    tx("r04", CHECKING, daysAgo(12), -45210, "ICA Supermarket Aptiten", "Matinköp"),
    tx("r05", CHECKING, daysAgo(10), 3500000, "Arbetsgivaren AB", "Lön"),
    tx("r06", SAVINGS, daysAgo(8), 100000, undefined, "Överföring sparande"),
  ];
}

/** In-memory BankProvider over the fixtures, with per-method call counters. */
export class FakeProvider {
  id = "fake";
  calls = { getAccount: 0, getBalances: 0, getTransactions: 0 };

  constructor(transactions = TRANSACTIONS) {
    this.transactions = transactions;
  }

  async listInstitutions() {
    return [{ id: "SE:Testbanken", name: "Testbanken" }];
  }
  async beginLink() {
    return { url: "https://bank.example/auth", referenceId: "ref-1" };
  }
  async completeLink() {
    return { sessionId: "sess-1", accountIds: [CHECKING, SAVINGS] };
  }
  async revokeSession() {}
  async getAccount(accountId) {
    this.calls.getAccount++;
    const account = ACCOUNTS.find((a) => a.id === accountId);
    if (!account) throw new Error(`Unknown account ${accountId}`);
    return account;
  }
  async getBalances(accountId) {
    this.calls.getBalances++;
    return BALANCES[accountId] ?? [];
  }
  async getTransactions(accountId, from, to) {
    this.calls.getTransactions++;
    return this.transactions.filter(
      (t) =>
        t.accountId === accountId &&
        (!from || (t.bookedAt ?? "") >= from) &&
        (!to || (t.bookedAt ?? "") <= to),
    );
  }
}

/** ConsentStrategy with both fixture accounts linked. */
export class FakeConsent {
  constructor(accountIds = [CHECKING, SAVINGS]) {
    this.ids = accountIds;
  }
  async listInstitutions() {
    return [{ id: "SE:Testbanken", name: "Testbanken" }];
  }
  async link() {
    return { accountIds: this.ids };
  }
  async accountIds() {
    return this.ids;
  }
  async listSessions() {
    return [
      {
        sessionId: "sess-1",
        institutionId: "SE:Testbanken",
        validUntil: "2026-12-01T00:00:00Z",
        accountIds: this.ids,
      },
    ];
  }
  async disconnect() {}
}

/** Engine over the fakes; pass a Cache to exercise the cached path. */
export function makeEngine(cache, provider = new FakeProvider()) {
  return { engine: new Engine(provider, new FakeConsent(), cache), provider };
}

/** Fresh temp dir for cache/key files. */
export function tempDir(prefix = "saldo-test-") {
  return mkdtemp(join(tmpdir(), prefix));
}

/**
 * formatMinor uses non-breaking spaces (U+00A0) as thousands separator and
 * before the currency symbol. Write expectations with plain spaces and run
 * them through this so the invisible difference can't bite.
 */
export function amt(display) {
  return display.replaceAll(" ", "\u00a0");
}
