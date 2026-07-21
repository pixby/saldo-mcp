import { createHash } from "node:crypto";
import type { Account, Balance, Institution, Transaction } from "../../domain/types.js";
import { toMinorUnits } from "../../util/money.js";
import type { TransactionKind } from "../../domain/types.js";
import type {
  EBAccountDetails,
  EBAspsp,
  EBBalance,
  EBTransaction,
} from "./types.js";

/**
 * Enable Banking identifies a bank by (name, country), not a single opaque id.
 * We encode both into our Institution.id as "COUNTRY:Name" so createLink can
 * reconstruct the aspsp. (Bank names may contain spaces — quote them on the CLI.)
 */
export function institutionId(country: string, name: string): string {
  return `${country.toUpperCase()}:${name}`;
}

export function parseInstitutionId(id: string): { country: string; name: string } {
  const idx = id.indexOf(":");
  if (idx === -1) throw new Error(`Malformed institution id "${id}" (expected "COUNTRY:Name").`);
  return { country: id.slice(0, idx), name: id.slice(idx + 1) };
}

export function mapInstitution(gc: EBAspsp): Institution {
  return {
    id: institutionId(gc.country, gc.name),
    name: gc.name,
    bic: gc.bic,
    logo: gc.logo,
  };
}

function ibanOf(all?: { scheme_name?: string; identification?: string }[]): string | undefined {
  return all?.find((a) => a.scheme_name?.toUpperCase() === "IBAN")?.identification;
}

export function mapAccountDetails(uid: string, d: EBAccountDetails): Account {
  return {
    id: uid,
    name: d.name,
    iban: d.account_id?.iban ?? ibanOf(d.all_account_ids),
    currency: d.currency,
  };
}

export function mapBalance(accountId: string, b: EBBalance): Balance {
  return {
    accountId,
    amount: {
      amountMinor: toMinorUnits(b.balance_amount.amount),
      currency: b.balance_amount.currency,
    },
    type: b.balance_type,
    referenceDate: b.reference_date,
  };
}

export function mapTransaction(accountId: string, t: EBTransaction): Transaction {
  // Enable Banking gives a positive amount + a direction indicator; we fold the
  // direction into the sign so the rest of the app sees signed minor units.
  const magnitude = Math.abs(toMinorUnits(t.transaction_amount.amount));
  const amountMinor = t.credit_debit_indicator === "DBIT" ? -magnitude : magnitude;
  const counterparty =
    t.credit_debit_indicator === "DBIT" ? t.creditor?.name : t.debtor?.name;

  return {
    id: t.transaction_id ?? t.entry_reference ?? syntheticId(accountId, t),
    accountId,
    bookedAt: t.booking_date ?? t.transaction_date,
    valueDate: t.value_date,
    amount: { amountMinor, currency: t.transaction_amount.currency },
    description: t.remittance_information?.join(" ") || undefined,
    counterparty: counterparty ?? undefined,
    kind: mapKind(t.bank_transaction_code?.description),
    status: "booked",
  };
}

/**
 * Map a bank transaction-code label to a coarse, provider-neutral kind. The
 * labels are bank-specific free text (these cover Nordea's Swedish set); an
 * unrecognised label returns undefined so behaviour is unchanged. Other
 * providers add their own vocabulary here or in their own mapper.
 */
function mapKind(description?: string): TransactionKind | undefined {
  if (!description) return undefined;
  const d = description.toLowerCase();
  if (d.includes("överföring") || d.includes("overföring") || d.includes("overforing")) {
    // "egna" = the user's own accounts; anything else is a transfer to a third party.
    return d.includes("egna") ? "internal_transfer" : "transfer";
  }
  if (d.includes("kortköp") || d.includes("kortkop") || d.includes("card")) return "card";
  if (d.includes("autogiro") || d.includes("direct debit")) return "direct_debit";
  if (d.includes("swish") || d.includes("bankgiro") || d.includes("bank giro")) return "transfer";
  return undefined;
}

/** Stable id for banks that omit a transaction id, so re-fetches dedupe. */
function syntheticId(accountId: string, t: EBTransaction): string {
  const seed = [
    accountId,
    t.booking_date ?? t.value_date ?? "",
    t.transaction_amount.amount,
    t.credit_debit_indicator,
    t.remittance_information?.join(" ") ?? t.creditor?.name ?? t.debtor?.name ?? "",
  ].join("|");
  return "syn_" + createHash("sha1").update(seed).digest("hex").slice(0, 20);
}
