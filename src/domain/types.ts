/**
 * Provider-neutral domain types.
 *
 * Everything above the provider layer (the Engine, the MCP tools, the CLI) speaks
 * ONLY these types. No provider-specific shape (Enable Banking, Tink, …) is
 * allowed to leak past a provider implementation. This makes the backend swappable.
 *
 * Money is always stored in minor units (öre for SEK) — never floats. Formatting
 * to "kr" happens only at presentation time.
 */

export interface Money {
  /** Amount in minor units (öre/cents). Negative for debits/outflows. */
  amountMinor: number;
  /** ISO 4217 currency code, e.g. "SEK". */
  currency: string;
}

export interface Institution {
  id: string;
  name: string;
  bic?: string;
  logo?: string;
  /** How many days of history this institution exposes, if known. */
  transactionTotalDays?: number;
}

export interface Account {
  /** Stable id we use everywhere (the provider's account id). */
  id: string;
  name?: string;
  iban?: string;
  currency?: string;
  institutionId?: string;
  ownerName?: string;
}

export interface Balance {
  accountId: string;
  amount: Money;
  /** Provider balance type, e.g. "closingBooked", "interimAvailable". */
  type: string;
  referenceDate?: string;
}

export type TransactionStatus = "booked" | "pending";

/**
 * Coarse transaction type, derived from the provider's bank-transaction code.
 * Lets us tell genuine spending apart from money the user just moved around
 * (e.g. a transfer between their own accounts, which is neither income nor an
 * expense). Provider-neutral: each provider maps its own codes onto these, and
 * an unknown/absent code simply leaves `kind` undefined (treated as before).
 */
export type TransactionKind =
  | "card" // card purchase
  | "transfer" // transfer or payment to another party
  | "internal_transfer" // moved between the user's own accounts — not spending or income
  | "direct_debit" // autogiro / scheduled pull
  | "other";

export interface Transaction {
  /** Provider transaction id; synthesized deterministically if the provider omits one. */
  id: string;
  accountId: string;
  /** ISO date (YYYY-MM-DD) the transaction was booked. */
  bookedAt?: string;
  valueDate?: string;
  amount: Money;
  /** Free-text description / remittance information. */
  description?: string;
  /** Other party (creditor for outflows, debtor for inflows), if the bank provides it. */
  counterparty?: string;
  /** Coarse type from the provider's transaction code, if known. */
  kind?: TransactionKind;
  status: TransactionStatus;
}
