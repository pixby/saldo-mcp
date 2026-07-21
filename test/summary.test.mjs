import { test } from "node:test";
import assert from "node:assert/strict";
import { getRecurringCharges, spendingByCategory, summarizePeriod } from "../dist/summary.js";
import { TRANSACTIONS } from "./helpers.mjs";

// Categories come from stored transaction labels (data enrichment), keyed by
// the exact transaction text. This is the map enrichment would have written
// for the fixture set.
const LABELS = new Map([
  ["Wallenstam AB", "Housing"],
  ["ICA Supermarket Aptiten", "Groceries"],
  ["Coop Konsum", "Groceries"],
  ["Spotify AB", "Subscriptions"],
]);

test("spendingByCategory groups outflows by stored label, largest first", () => {
  const summary = spendingByCategory(TRANSACTIONS, "category", LABELS);
  // Salary inflows must not appear as a spending category.
  assert.ok(!summary.some((s) => s.category === "Income"));
  // Rent (Wallenstam, labeled Housing) dominates the fixtures.
  assert.equal(summary[0].category, "Housing");
  assert.equal(summary[0].spentMinor, 3 * 850000);
  assert.equal(summary[0].transactionCount, 3);
  const groceries = summary.find((s) => s.category === "Groceries");
  assert.equal(groceries.spentMinor, 45210 + 61550 + 23085);
  assert.equal(groceries.transactionCount, 3);
  // Everything is reported as positive "spent" minor units.
  for (const s of summary) assert.ok(s.spentMinor > 0);
});

test("spending without a stored label reports as Uncategorized", () => {
  const summary = spendingByCategory(TRANSACTIONS); // no labels at all
  assert.ok(summary.some((s) => s.category === "Uncategorized"));
  assert.ok(!summary.some((s) => s.category === "Housing"), "no labels → no categories");
  // Grouping by exact counterparty ignores labels entirely.
  const byParty = spendingByCategory(TRANSACTIONS, "counterparty");
  assert.ok(byParty.some((s) => s.category === "Wallenstam AB"));
});

test("spendingByCategory of an empty period is empty", () => {
  assert.deepEqual(spendingByCategory([]), []);
});

test("internal transfers are excluded from spending, recurring and period totals", () => {
  const mk = (id, amountMinor, bookedAt, kind, counterparty) => ({
    id,
    accountId: "acc",
    bookedAt,
    amount: { amountMinor, currency: "SEK" },
    counterparty,
    kind,
    status: "booked",
  });
  const txs = [
    mk("s1", -45210, "2025-06-10", "card", "ICA Supermarket Aptiten"), // real spend
    // A big move between the user's own accounts in both months — must NOT count.
    mk("i1", -600000, "2025-05-15", "internal_transfer", "Eget sparkonto"),
    mk("i2", -600000, "2025-06-15", "internal_transfer", "Eget sparkonto"),
    mk("i3", 600000, "2025-06-16", "internal_transfer", "Lönekonto"), // the inflow leg
  ];

  const spend = spendingByCategory(txs);
  assert.equal(spend.reduce((n, s) => n + s.spentMinor, 0), 45210, "only the real card spend counts");
  assert.ok(!spend.some((s) => s.category === "Transfers"));

  // Appears in two months but is an internal move → not a recurring charge.
  assert.deepEqual(getRecurringCharges(txs), []);

  const june = summarizePeriod(txs.filter((t) => t.bookedAt.startsWith("2025-06")));
  assert.equal(june.spentMinor, 45210, "internal transfer out is not spending");
  assert.equal(june.receivedMinor, 0, "internal transfer in is not income");
  assert.equal(june.transactionCount, 1, "internal transfers are left out of the count");
});

test("getRecurringCharges finds charges present in >= 2 distinct months", () => {
  const recurring = getRecurringCharges(TRANSACTIONS);
  const spotify = recurring.find((r) => r.counterparty === "Spotify AB");
  assert.ok(spotify, "Spotify should be detected as recurring");
  assert.equal(spotify.occurrences, 3);
  assert.deepEqual(spotify.months, ["2025-04", "2025-05", "2025-06"]);
  assert.equal(spotify.typicalAmountMinor, 11900);
  // ICA appears twice but only within June -> one distinct month -> excluded.
  assert.ok(!recurring.some((r) => r.counterparty?.startsWith("ICA")));
  // Inflows (salary) are never "charges", even though they recur monthly.
  assert.ok(!recurring.some((r) => r.counterparty === "Arbetsgivaren AB"));
});

test("getRecurringCharges skips transactions without counterparty or date", () => {
  const noParty = [
    { id: "x1", accountId: "a", bookedAt: "2025-01-01", amount: { amountMinor: -100, currency: "SEK" }, status: "booked" },
    { id: "x2", accountId: "a", amount: { amountMinor: -100, currency: "SEK" }, counterparty: "X", status: "pending" },
  ];
  assert.deepEqual(getRecurringCharges(noParty), []);
});

test("summarizePeriod totals spent/received/net in minor units", () => {
  const june = TRANSACTIONS.filter((t) => t.bookedAt?.startsWith("2025-06"));
  const s = summarizePeriod(june);
  assert.equal(s.currency, "SEK");
  assert.equal(s.spentMinor, 11900 + 850000 + 45210 + 61550 + 23085 + 19900);
  assert.equal(s.receivedMinor, 3500000 + 100000);
  assert.equal(s.netMinor, s.receivedMinor - s.spentMinor);
  assert.equal(s.transactionCount, june.length);
});

test("summarizePeriod of nothing is all zeros", () => {
  assert.deepEqual(summarizePeriod([]), {
    currency: "",
    spentMinor: 0,
    receivedMinor: 0,
    netMinor: 0,
    transactionCount: 0,
  });
});
