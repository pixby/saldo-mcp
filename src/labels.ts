import type { Transaction } from "./domain/types.js";

/**
 * Transaction labeling ("data enrichment").
 *
 * Labels are written by the user's own AI assistant over MCP: the assistant
 * reads unlabeled descriptions (`get_unlabeled_transactions`), classifies them
 * itself, and stores the results (`set_transaction_labels`) — computed once per
 * distinct description and kept in the encrypted local cache. No API key, no
 * extra network egress: the assistant already reads the transactions, and the
 * labels never leave the device. The math above this layer
 * (spending_by_category, …) stays deterministic; only the labels are
 * model-made. "The model decides what things are; the code counts."
 *
 * Descriptions are used EXACTLY as the bank renders them — no normalization —
 * so what gets labeled is a 1:1 match with what the user sees in their own
 * internet bank.
 */

/** The label taxonomy. A label may only be one of these. */
export const CATEGORIES = [
  "Groceries",
  "Dining",
  "Fuel",
  "Transport",
  "Subscriptions",
  "Utilities",
  "Shopping",
  "Health",
  "Entertainment",
  "Housing",
  "Cash",
  "Fees",
  "Transfers",
] as const;

export type Category = (typeof CATEGORIES)[number];

/** A stored description → category label. */
export interface TransactionLabel {
  /** The raw transaction text, exactly as the bank rendered it. */
  text: string;
  category: string;
  /** Who wrote it (e.g. "assistant:claude-ai"). */
  source: string;
  labeledAt: string;
}

/** The text a transaction is labeled (and displayed) by: the counterparty when
 *  the bank provides one, otherwise the raw description. */
export function transactionText(
  tx: Pick<Transaction, "counterparty" | "description">,
): string {
  return tx.counterparty?.trim() || tx.description?.trim() || "";
}
