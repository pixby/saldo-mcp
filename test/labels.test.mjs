import { test } from "node:test";
import assert from "node:assert/strict";
import { CATEGORIES, transactionText } from "../dist/labels.js";

test("transactionText prefers the counterparty and never invents or alters text", () => {
  // Counterparty wins when the bank provides one.
  assert.equal(
    transactionText({ counterparty: "TESTBOLAGET AB", description: "Swish betalning TESTBOLAGET AB" }),
    "TESTBOLAGET AB",
  );
  // Otherwise the raw description, exactly as rendered — no normalization:
  // what gets labeled is a 1:1 match with the user's own internet bank.
  assert.equal(
    transactionText({ counterparty: undefined, description: "Kortköp 260421 TESTLIVS AB" }),
    "Kortköp 260421 TESTLIVS AB",
  );
  assert.equal(transactionText({ counterparty: "  ", description: undefined }), "");
});

test("the taxonomy is closed and stable", () => {
  assert.equal(CATEGORIES.length, 13);
  assert.ok(CATEGORIES.includes("Groceries"));
  assert.ok(!CATEGORIES.includes("Unknown"), '"Unknown" is a decline, not a category');
});
