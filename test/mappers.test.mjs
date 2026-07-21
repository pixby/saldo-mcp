import { test } from "node:test";
import assert from "node:assert/strict";
import {
  institutionId,
  mapAccountDetails,
  mapBalance,
  mapTransaction,
  parseInstitutionId,
} from "../dist/providers/enablebanking/mappers.js";

test("institution id round-trips country + name (names may contain colons)", () => {
  const id = institutionId("se", "Banken: Special");
  assert.equal(id, "SE:Banken: Special");
  assert.deepEqual(parseInstitutionId(id), { country: "SE", name: "Banken: Special" });
  assert.throws(() => parseInstitutionId("no-colon"), /Malformed institution id/);
});

test("mapTransaction folds DBIT/CRDT indicator into the amount sign", () => {
  const base = {
    transaction_id: "eb-1",
    booking_date: "2025-06-10",
    value_date: "2025-06-11",
    transaction_amount: { amount: "452.10", currency: "SEK" },
    remittance_information: ["Matinköp", "kvitto 1"],
    creditor: { name: "ICA" },
    debtor: { name: "Someone Else" },
  };
  const debit = mapTransaction("acc-1", { ...base, credit_debit_indicator: "DBIT" });
  assert.equal(debit.amount.amountMinor, -45210);
  assert.equal(debit.counterparty, "ICA"); // creditor for outflows
  assert.equal(debit.description, "Matinköp kvitto 1");
  assert.equal(debit.bookedAt, "2025-06-10");
  assert.equal(debit.status, "booked");

  const credit = mapTransaction("acc-1", { ...base, credit_debit_indicator: "CRDT" });
  assert.equal(credit.amount.amountMinor, 45210);
  assert.equal(credit.counterparty, "Someone Else"); // debtor for inflows
});

test("mapTransaction derives a coarse kind from the bank transaction code", () => {
  const base = {
    booking_date: "2025-06-10",
    transaction_amount: { amount: "100.00", currency: "SEK" },
    credit_debit_indicator: "DBIT",
  };
  const kindOf = (description) =>
    mapTransaction("acc-1", { ...base, bank_transaction_code: { description } }).kind;

  assert.equal(kindOf("Kortköp"), "card");
  assert.equal(kindOf("Överföring egna"), "internal_transfer"); // own accounts
  assert.equal(kindOf("Överföring andras"), "transfer"); // to someone else
  assert.equal(kindOf("Autogiro"), "direct_debit");
  assert.equal(kindOf("Swish Företag"), "transfer");
  assert.equal(kindOf("BankGiro"), "transfer");
  assert.equal(kindOf("Något helt annat"), undefined); // unknown label → unchanged behaviour
  assert.equal(mapTransaction("acc-1", base).kind, undefined); // no code at all
});

test("mapTransaction synthesizes a stable id when the bank omits one", () => {
  const noId = {
    booking_date: "2025-06-10",
    transaction_amount: { amount: "10.00", currency: "SEK" },
    credit_debit_indicator: "DBIT",
    creditor: { name: "X" },
  };
  const a = mapTransaction("acc-1", noId);
  const b = mapTransaction("acc-1", noId);
  assert.match(a.id, /^syn_[0-9a-f]{20}$/);
  assert.equal(a.id, b.id, "same input must synthesize the same id (dedupe on re-fetch)");
  const other = mapTransaction("acc-2", noId);
  assert.notEqual(a.id, other.id, "different account must synthesize a different id");
});

test("mapBalance and mapAccountDetails map EB shapes to domain types", () => {
  const balance = mapBalance("acc-1", {
    balance_amount: { amount: "-12.34", currency: "SEK" },
    balance_type: "interimAvailable",
    reference_date: "2025-06-30",
  });
  assert.deepEqual(balance, {
    accountId: "acc-1",
    amount: { amountMinor: -1234, currency: "SEK" },
    type: "interimAvailable",
    referenceDate: "2025-06-30",
  });

  const account = mapAccountDetails("uid-1", {
    name: "Lönekonto",
    currency: "SEK",
    all_account_ids: [{ scheme_name: "IBAN", identification: "SE35..." }],
  });
  assert.equal(account.id, "uid-1");
  assert.equal(account.iban, "SE35...", "falls back to all_account_ids when account_id.iban missing");
});
