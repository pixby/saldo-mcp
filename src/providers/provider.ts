import type { Account, Balance, Institution, Transaction } from "../domain/types.js";

/** Returned when a bank-authorization flow is started. */
export interface BeginLinkResult {
  /** URL the user must open to authenticate with their bank (BankID etc.). */
  url: string;
  /** Provider-native reference for the started authorization (diagnostics). */
  referenceId: string;
}

/** Returned after exchanging the redirect `code` for a usable session. */
export interface CompletedLink {
  /** Provider session/consent id. */
  sessionId: string;
  /** Account ids that became accessible through this consent. */
  accountIds: string[];
  /** ISO timestamp the consent expires (for renewal reminders), if known. */
  validUntil?: string;
}

/**
 * The one interface every open-banking backend implements.
 *
 * Enable Banking implements it today; Tink will implement the same surface later,
 * and nothing above this layer has to change. Providers are stateless about which
 * accounts a user has linked — that lives in the engine's state store. A provider
 * only knows how to talk to its upstream API.
 *
 * The link flow is code-exchange based (redirect → `code` → session), which is
 * how both Enable Banking and Tink work: `beginLink` returns a URL, the user
 * authenticates, the bank redirects back with a `code`, and `completeLink`
 * exchanges it. The engine owns capturing the code (a localhost callback).
 */
export interface BankProvider {
  /** Stable identifier, e.g. "enablebanking" or "tink". */
  readonly id: string;

  /** List banks available in a country (ISO 3166-1 alpha-2, e.g. "SE"). */
  listInstitutions(country: string): Promise<Institution[]>;

  /** Start a bank-authentication flow; returns a URL the user must open. */
  beginLink(params: {
    institutionId: string;
    redirectUrl: string;
    state: string;
  }): Promise<BeginLinkResult>;

  /** Exchange the redirect `code` for a session with accessible accounts. */
  completeLink(code: string): Promise<CompletedLink>;

  /** Revoke a consent session at the provider (best-effort; used on disconnect). */
  revokeSession(sessionId: string): Promise<void>;

  /** Fetch metadata for a single account. */
  getAccount(accountId: string): Promise<Account>;

  /** Current balances for an account. */
  getBalances(accountId: string): Promise<Balance[]>;

  /**
   * Booked transactions for an account, optionally bounded by ISO dates
   * (YYYY-MM-DD). The hot path — provider talks to the bank API directly; data
   * is never routed through any Saldo server.
   */
  getTransactions(accountId: string, from?: string, to?: string): Promise<Transaction[]>;
}
