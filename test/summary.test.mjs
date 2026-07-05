import { test } from "node:test";
import assert from "node:assert/strict";
import { getRecurringCharges, spendingByCategory, summarizePeriod } from "../dist/summary.js";
import { categorize } from "../dist/categorize.js";
import { TRANSACTIONS } from "./helpers.mjs";

test("spendingByCategory groups outflows only, largest first", () => {
  const summary = spendingByCategory(TRANSACTIONS);
  // Salary inflows must not appear as a spending category.
  assert.ok(!summary.some((s) => s.category === "Income"));
  // Rent (Wallenstam → Housing) dominates the fixtures.
  assert.equal(summary[0].category, "Housing");
  assert.equal(summary[0].spentMinor, 3 * 850000);
  assert.equal(summary[0].transactionCount, 3);
  const groceries = summary.find((s) => s.category === "Groceries");
  assert.equal(groceries.spentMinor, 45210 + 61550 + 23085);
  assert.equal(groceries.transactionCount, 3);
  // Everything is reported as positive "spent" minor units.
  for (const s of summary) assert.ok(s.spentMinor > 0);
});

test("spendingByCategory of an empty period is empty", () => {
  assert.deepEqual(spendingByCategory([]), []);
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

test("categorize matches Swedish merchants and falls back sensibly", () => {
  const t = (counterparty, amountMinor = -100, description) => ({
    counterparty,
    description,
    amount: { amountMinor, currency: "SEK" },
  });
  assert.equal(categorize(t("ICA Supermarket Aptiten")), "Groceries");
  assert.equal(categorize(t("Spotify AB")), "Subscriptions");
  assert.equal(categorize(t("Wallenstam AB")), "Housing");
  assert.equal(categorize(t("SL")), "Transport");
  assert.equal(categorize(t("Okänd Butik AB")), "Uncategorized");
  assert.equal(categorize(t("Arbetsgivaren AB", 3500000)), "Income");
});
