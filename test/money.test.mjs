import { test } from "node:test";
import assert from "node:assert/strict";
import { formatMinor, formatMoney, toMinorUnits } from "../dist/util/money.js";
import { amt } from "./helpers.mjs";

test("toMinorUnits parses decimal strings without float drift", () => {
  assert.equal(toMinorUnits("12.34"), 1234);
  assert.equal(toMinorUnits("-1234.56"), -123456);
  assert.equal(toMinorUnits("0.07"), 7);
  // the classic float trap: 12.34 * 100 === 1233.9999999999998
  assert.equal(toMinorUnits("1180.02"), 118002);
});

test("toMinorUnits handles missing/short fraction digits", () => {
  assert.equal(toMinorUnits("12"), 1200);
  assert.equal(toMinorUnits("12.3"), 1230);
  assert.equal(toMinorUnits("-5"), -500);
  assert.equal(toMinorUnits(" 42.00 "), 4200);
});

test("formatMinor renders Swedish style (NBSP separators, kr suffix)", () => {
  assert.equal(formatMinor(123456, "SEK"), amt("1 234,56 kr"));
  assert.equal(formatMinor(-123456, "SEK"), amt("-1 234,56 kr"));
  assert.equal(formatMinor(7, "SEK"), amt("0,07 kr"));
  assert.equal(formatMinor(350000000, "SEK"), amt("3 500 000,00 kr"));
});

test("formatMinor falls back to the currency code for unknown currencies", () => {
  assert.equal(formatMinor(1000, "CHF"), amt("10,00 CHF"));
  assert.equal(formatMinor(1000, "EUR"), amt("10,00 €"));
});

test("formatMoney formats a Money object", () => {
  assert.equal(formatMoney({ amountMinor: -11900, currency: "SEK" }), amt("-119,00 kr"));
});
