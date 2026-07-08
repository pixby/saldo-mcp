import type { Account, Balance, Transaction } from "./domain/types.js";
import type { BankProvider } from "./providers/provider.js";
import { type ConnectedSession, type ConsentStrategy, isExpired } from "./consent/consent.js";
import type { Entitlement } from "./consent/consent.js";
import type { Cache } from "./cache/cache.js";

/** How much history a sync requests: wider than any bank actually serves
 *  (most cap AIS at ~90 days; the generous ones reach a year or two, usually
 *  right after a fresh consent), while plausible enough not to trip
 *  date-range validators. We take whatever the bank returns. */
const SYNC_HISTORY_DAYS = 1095; // 3 years
/** Retry window for banks that reject an out-of-range date_from outright
 *  (a 400) instead of clamping it to what they're willing to serve. */
const SYNC_HISTORY_FALLBACK_DAYS = 90;

/**
 * The engine is the headless core. It owns data fetching (via `provider`, which
 * always calls the bank API directly), the local cache, and the summary tools —
 * and delegates consent + "which accounts are linked" to a `ConsentStrategy`.
 * That split is what lets the same engine serve both self-host and managed mode:
 * only the consent strategy and the provider's token source differ.
 *
 * With a Cache present, reads are served from it and the provider is only touched
 * on sync(). Deliberately UI-agnostic so the Mac App and headless path share it.
 */
export class Engine {
  constructor(
    private readonly provider: BankProvider,
    private readonly consent: ConsentStrategy,
    private readonly cache?: Cache,
  ) {}

  get providerId(): string {
    return this.provider.id;
  }

  get cacheEnabled(): boolean {
    return Boolean(this.cache);
  }

  /** Ids of accounts the user has connected. */
  accountIds(): Promise<string[]> {
    return this.consent.accountIds();
  }

  listInstitutions(country: string) {
    return this.consent.listInstitutions(country);
  }

  link(institutionId: string, openUrl: (url: string) => void | Promise<void>) {
    return this.consent.link(institutionId, openUrl);
  }

  /** All connected bank sessions (institution, accounts, consent expiry). */
  listSessions(): Promise<ConnectedSession[]> {
    return this.consent.listSessions();
  }

  /** Disconnect a bank connection (removes it and revokes consent at the provider). */
  disconnect(sessionId: string): Promise<void> {
    return this.consent.disconnect(sessionId);
  }

  /**
   * Consent status with days-until-expiry, for renewal reminders. `expiringSoon`
   * flags sessions expiring within `withinDays` (default 14) or already expired.
   */
  /** Subscription/trial state. Self-host has no billing → "unlimited". */
  getEntitlement(): Promise<Entitlement> {
    return (
      this.consent.entitlement?.() ??
      Promise.resolve({ status: "unlimited", plan: "individual" } as Entitlement)
    );
  }

  /** Hosted checkout URL (managed mode only). */
  createBillingCheckout(plan: "individual" | "business"): Promise<{ url: string }> {
    if (!this.consent.createCheckout) {
      return Promise.reject(new Error("Billing applies to the managed tier only."));
    }
    return this.consent.createCheckout(plan);
  }

  /** Email a subscription-restore code (managed mode only). */
  restoreSubscriptionStart(email: string): Promise<void> {
    if (!this.consent.restoreStart) {
      return Promise.reject(new Error("Restore applies to the managed tier only."));
    }
    return this.consent.restoreStart(email);
  }

  /** Verify a restore code; on success this device carries the subscription. */
  restoreSubscriptionVerify(
    email: string,
    code: string,
  ): Promise<{ email: string; entitlement: Entitlement }> {
    if (!this.consent.restoreVerify) {
      return Promise.reject(new Error("Restore applies to the managed tier only."));
    }
    return this.consent.restoreVerify(email, code);
  }

  async consentStatus(
    withinDays = 14,
  ): Promise<{ sessionId: string; institutionId: string; validUntil?: string; daysLeft?: number; expiringSoon: boolean }[]> {
    const now = Date.now();
    const sessions = await this.consent.listSessions();
    return sessions.map((s) => {
      const daysLeft = s.validUntil
        ? Math.floor((new Date(s.validUntil).getTime() - now) / 86400_000)
        : undefined;
      const expiringSoon = isExpired(s.validUntil, now) || (daysLeft !== undefined && daysLeft <= withinDays);
      return {
        sessionId: s.sessionId,
        institutionId: s.institutionId,
        validUntil: s.validUntil,
        daysLeft,
        expiringSoon,
      };
    });
  }

  async listAccounts(): Promise<Account[]> {
    const ids = await this.consent.accountIds();
    if (!this.cache) return Promise.all(ids.map((id) => this.provider.getAccount(id)));
    // Serve from the cache, but never let it hide a fresh consent: re-linking
    // a bank mints account ids the cache has not seen yet — fetch just those.
    const cached = this.cache.getAccounts();
    const have = new Set(cached.map((a) => a.id));
    const missing = ids.filter((id) => !have.has(id));
    if (!missing.length) return cached;
    const fresh = await Promise.all(missing.map((id) => this.provider.getAccount(id)));
    this.cache.upsertAccounts(fresh);
    return [...cached, ...fresh];
  }

  /** Balances are current-state and low-volume, so always fetched live. */
  async getBalances(accountId?: string): Promise<Balance[]> {
    const ids = accountId ? [accountId] : await this.consent.accountIds();
    const nested = await Promise.all(ids.map((id) => this.provider.getBalances(id)));
    return nested.flat();
  }

  async getTransactions(accountId: string, from?: string, to?: string): Promise<Transaction[]> {
    if (this.cache) {
      if (!this.cache.getLastSyncedAt(accountId)) await this.sync(accountId);
      return this.cache.getTransactions(accountId, from, to);
    }
    return this.provider.getTransactions(accountId, from, to);
  }

  /** Transactions across every linked account, merged and sorted newest-first. */
  async getAllTransactions(from?: string, to?: string): Promise<Transaction[]> {
    const ids = await this.consent.accountIds();
    if (this.cache) {
      for (const id of ids) {
        if (!this.cache.getLastSyncedAt(id)) await this.sync(id);
      }
      return this.cache.getAllTransactions(from, to);
    }
    const nested = await Promise.all(ids.map((id) => this.provider.getTransactions(id, from, to)));
    return nested.flat().sort((a, b) => (b.bookedAt ?? "").localeCompare(a.bookedAt ?? ""));
  }

  /**
   * Pull fresh data from the provider into the cache. Fetches the provider's
   * available window (up to SYNC_HISTORY_DAYS); the cache accumulates history
   * across syncs. Returns how many accounts and transactions were synced.
   */
  async sync(accountId?: string): Promise<{ accounts: number; transactions: number }> {
    if (!this.cache) return { accounts: 0, transactions: 0 };
    const cache = this.cache;
    const ids = accountId ? [accountId] : await this.consent.accountIds();
    const now = new Date().toISOString();
    const from = new Date(Date.now() - SYNC_HISTORY_DAYS * 86400_000).toISOString().slice(0, 10);
    const fallbackFrom = new Date(Date.now() - SYNC_HISTORY_FALLBACK_DAYS * 86400_000)
      .toISOString()
      .slice(0, 10);

    let txCount = 0;
    for (const id of ids) {
      const account = await this.provider.getAccount(id);
      let transactions;
      try {
        transactions = await this.provider.getTransactions(id, from);
      } catch {
        // Bank refused the wide range — retry with a window every bank serves.
        transactions = await this.provider.getTransactions(id, fallbackFrom);
      }
      cache.upsertAccounts([account]);
      cache.upsertTransactions(transactions);
      cache.setLastSyncedAt(id, now);
      txCount += transactions.length;
    }
    return { accounts: ids.length, transactions: txCount };
  }
}
