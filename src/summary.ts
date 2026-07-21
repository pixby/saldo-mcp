import type { Transaction } from "./domain/types.js";
import { transactionText } from "./labels.js";

/**
 * Pure functions that turn raw transactions into the pre-computed summaries the
 * MCP tools expose. Kept provider-neutral and side-effect-free so they're easy
 * to test and reuse. Amounts stay in minor units throughout.
 *
 * Note: open-banking APIs don't reliably return a merchant category, so
 * categories come from the stored merchant labels written by data enrichment
 * (see categorizer.ts); transactions without a label report "Uncategorized".
 */

export interface CategorySummary {
  category: string;
  currency: string;
  /** Total outflow in minor units (positive number = money spent). */
  spentMinor: number;
  transactionCount: number;
}

export interface RecurringCharge {
  counterparty: string;
  currency: string;
  /** Typical charge in minor units (positive number). */
  typicalAmountMinor: number;
  occurrences: number;
  /** Distinct year-months the charge appeared in. */
  months: string[];
}

export interface PeriodComparison {
  currency: string;
  spentMinor: number;
  receivedMinor: number;
  netMinor: number;
  transactionCount: number;
}

function yearMonth(tx: Transaction): string | undefined {
  return tx.bookedAt?.slice(0, 7);
}

/** Group spending (outflows only) by labeled category (default) or by exact
 *  counterparty, largest first. `labels` maps exact transaction texts to
 *  categories (see Engine.transactionLabels); unlabeled spending is
 *  "Uncategorized". */
export function spendingByCategory(
  transactions: Transaction[],
  groupBy: "category" | "counterparty" = "category",
  labels: ReadonlyMap<string, string> = new Map(),
): CategorySummary[] {
  const byCategory = new Map<string, CategorySummary>();
  for (const tx of transactions) {
    if (tx.amount.amountMinor >= 0 || tx.kind === "internal_transfer") continue; // real outflows only
    const key =
      groupBy === "counterparty"
        ? transactionText(tx) || "Unknown"
        : labels.get(transactionText(tx)) ?? "Uncategorized";
    const existing = byCategory.get(key);
    if (existing) {
      existing.spentMinor += -tx.amount.amountMinor;
      existing.transactionCount += 1;
    } else {
      byCategory.set(key, {
        category: key,
        currency: tx.amount.currency,
        spentMinor: -tx.amount.amountMinor,
        transactionCount: 1,
      });
    }
  }
  return [...byCategory.values()].sort((a, b) => b.spentMinor - a.spentMinor);
}

/**
 * Detect likely recurring charges: an outflow to the same counterparty that
 * appears in at least `minMonths` distinct months. Catches subscriptions, rent,
 * memberships. Amounts are allowed to vary; we report the median-ish typical.
 */
export function getRecurringCharges(
  transactions: Transaction[],
  minMonths = 2,
): RecurringCharge[] {
  const groups = new Map<string, { amounts: number[]; months: Set<string>; currency: string }>();
  for (const tx of transactions) {
    if (tx.amount.amountMinor >= 0 || tx.kind === "internal_transfer") continue;
    const party = tx.counterparty?.trim();
    const month = yearMonth(tx);
    if (!party || !month) continue;
    const g = groups.get(party) ?? { amounts: [], months: new Set(), currency: tx.amount.currency };
    g.amounts.push(-tx.amount.amountMinor);
    g.months.add(month);
    groups.set(party, g);
  }

  const result: RecurringCharge[] = [];
  for (const [counterparty, g] of groups) {
    if (g.months.size < minMonths) continue;
    const sorted = [...g.amounts].sort((a, b) => a - b);
    const typical = sorted[Math.floor(sorted.length / 2)] ?? 0;
    result.push({
      counterparty,
      currency: g.currency,
      typicalAmountMinor: typical,
      occurrences: g.amounts.length,
      months: [...g.months].sort(),
    });
  }
  return result.sort((a, b) => b.occurrences - a.occurrences);
}

/** Totals for a single set of transactions (already filtered to a period). */
export function summarizePeriod(transactions: Transaction[]): PeriodComparison {
  let spentMinor = 0;
  let receivedMinor = 0;
  let transactionCount = 0;
  let currency = "";
  for (const tx of transactions) {
    // Internal moves between the user's own accounts are neither income nor
    // spending — leave them out of the totals (and the count) entirely.
    if (tx.kind === "internal_transfer") continue;
    currency ||= tx.amount.currency;
    transactionCount += 1;
    if (tx.amount.amountMinor < 0) spentMinor += -tx.amount.amountMinor;
    else receivedMinor += tx.amount.amountMinor;
  }
  return {
    currency,
    spentMinor,
    receivedMinor,
    netMinor: receivedMinor - spentMinor,
    transactionCount,
  };
}
