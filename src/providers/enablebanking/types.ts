/** Raw Enable Banking API response shapes. Isolated to this folder — nothing
 * outside the Enable Banking provider should import these. Base: api.enablebanking.com */

export interface EBAmount {
  amount: string; // always a positive decimal string; sign comes from credit_debit_indicator
  currency: string;
}

export interface EBAspsp {
  name: string;
  country: string;
  bic?: string;
  logo?: string;
  psu_types?: string[];
}

export interface EBAspspsResponse {
  aspsps: EBAspsp[];
}

export interface EBAuthResponse {
  url: string;
  authorization_id: string;
  psu_id_hash?: string;
}

export interface EBAccountRef {
  uid: string;
  account_id?: { iban?: string; other?: { identification?: string } };
  all_account_ids?: { scheme_name?: string; identification?: string }[];
  name?: string;
  currency?: string;
  cash_account_type?: string;
  product?: string;
}

export interface EBSessionResponse {
  session_id: string;
  status?: string;
  accounts: EBAccountRef[];
  aspsp?: EBAspsp;
  access?: { valid_until?: string };
}

export interface EBBalance {
  name?: string;
  balance_amount: EBAmount;
  balance_type: string;
  reference_date?: string;
}

export interface EBBalancesResponse {
  balances: EBBalance[];
}

export interface EBTransaction {
  transaction_id?: string;
  entry_reference?: string;
  booking_date?: string;
  value_date?: string;
  transaction_date?: string;
  credit_debit_indicator: "CRDT" | "DBIT";
  transaction_amount: EBAmount;
  debtor?: { name?: string };
  creditor?: { name?: string };
  remittance_information?: string[];
  /**
   * Bank transaction code. The ISO 20022 `code`/`sub_code` are frequently null,
   * but many banks put a human label in `description` (e.g. "Kortköp",
   * "Överföring egna", "Autogiro") that we can map to a coarse kind.
   */
  bank_transaction_code?: { description?: string; code?: string; sub_code?: string };
}

export interface EBTransactionsResponse {
  transactions: EBTransaction[];
  continuation_key?: string;
}

export interface EBAccountDetails {
  uid?: string;
  name?: string;
  currency?: string;
  account_id?: { iban?: string };
  all_account_ids?: { scheme_name?: string; identification?: string }[];
}
