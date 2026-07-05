import type { Account, Balance, Transaction } from "./domain/types.js";
import type { BankProvider } from "./providers/provider.js";
import { type ConnectedSession, type ConsentStrategy, isExpired } from "./consent/consent.js";
import type { Cache } from "./cache/cache.js";

/** How much history a sync requests. Banks cap this (~90 days is typical for AIS
 *  without re-auth); we ask wide and take whatever the bank returns. */
const SYNC_HISTORY_DAYS = 90;

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
    if (this.cache) {
      const cached = this.cache.getAccounts();
      if (cached.length) return cached;
      const fresh = await Promise.all(ids.map((id) => this.provider.getAccount(id)));
      this.cache.upsertAccounts(fresh);
      return fresh;
    }
    return Promise.all(ids.map((id) => this.provider.getAccount(id)));
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

    let txCount = 0;
    for (const id of ids) {
      const [account, transactions] = await Promise.all([
        this.provider.getAccount(id),
        this.provider.getTransactions(id, from),
      ]);
      cache.upsertAccounts([account]);
      cache.upsertTransactions(transactions);
      cache.setLastSyncedAt(id, now);
      txCount += transactions.length;
    }
    return { accounts: ids.length, transactions: txCount };
  }
}
