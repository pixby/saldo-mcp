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
  status: TransactionStatus;
}
