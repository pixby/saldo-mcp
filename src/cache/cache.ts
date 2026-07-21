import { DatabaseSync } from "node:sqlite";
import { mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import { createHash } from "node:crypto";
import type { Account, Transaction } from "../domain/types.js";
import type { TransactionLabel } from "../labels.js";
import { Cipher, loadOrCreateKey } from "./crypto.js";

/**
 * Encrypted local cache for accounts and transactions.
 *
 * - Storage: `node:sqlite` (built into Node 24) — no native dependency.
 * - Privacy: sensitive fields live in an AES-256-GCM blob (`payload`). Only the
 *   columns we must query on — ids and the booking date — are stored in the
 *   clear so date-range lookups stay indexed. Dates alone (no amounts, names, or
 *   descriptions) is an acceptable, minimal leak for a first cut.
 * - Purpose: keep history beyond the bank's window and cut provider calls,
 *   which are often rate-limited per account per day.
 */
export class Cache {
  private constructor(
    private readonly db: DatabaseSync,
    private readonly cipher: Cipher,
  ) {}

  /** Open (and create/migrate) the cache at dbPath, keyed from dataDir. */
  static async open(dbPath: string, dataDir: string): Promise<Cache> {
    await mkdir(dirname(dbPath), { recursive: true });
    const key = await loadOrCreateKey(dataDir);
    const db = new DatabaseSync(dbPath);
    db.exec(`
      CREATE TABLE IF NOT EXISTS accounts (
        id TEXT PRIMARY KEY,
        payload BLOB NOT NULL
      );
      CREATE TABLE IF NOT EXISTS transactions (
        id TEXT PRIMARY KEY,
        account_id TEXT NOT NULL,
        booked_at TEXT,
        payload BLOB NOT NULL
      );
      CREATE INDEX IF NOT EXISTS ix_tx_account_date
        ON transactions (account_id, booked_at);
      CREATE TABLE IF NOT EXISTS sync_meta (
        account_id TEXT PRIMARY KEY,
        last_synced_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS transaction_labels (
        text_hash TEXT PRIMARY KEY,
        payload BLOB NOT NULL
      );
    `);
    return new Cache(db, new Cipher(key));
  }

  // --- accounts ---

  upsertAccounts(accounts: Account[]): void {
    const stmt = this.db.prepare(
      "INSERT INTO accounts (id, payload) VALUES (?, ?) " +
        "ON CONFLICT(id) DO UPDATE SET payload = excluded.payload",
    );
    for (const account of accounts) {
      stmt.run(account.id, this.cipher.encryptJson(account));
    }
  }

  getAccounts(): Account[] {
    const rows = this.db.prepare("SELECT payload FROM accounts").all() as {
      payload: Uint8Array;
    }[];
    return rows.map((r) => this.cipher.decryptJson<Account>(Buffer.from(r.payload)));
  }

  // --- transactions ---

  upsertTransactions(transactions: Transaction[]): void {
    const stmt = this.db.prepare(
      "INSERT INTO transactions (id, account_id, booked_at, payload) VALUES (?, ?, ?, ?) " +
        "ON CONFLICT(id) DO UPDATE SET payload = excluded.payload, booked_at = excluded.booked_at",
    );
    for (const tx of transactions) {
      stmt.run(tx.id, tx.accountId, tx.bookedAt ?? null, this.cipher.encryptJson(tx));
    }
  }

  getTransactions(accountId: string, from?: string, to?: string): Transaction[] {
    return this.query(
      "SELECT payload FROM transactions WHERE account_id = ?" + this.dateClause(from, to) +
        " ORDER BY booked_at DESC",
      [accountId, ...this.dateParams(from, to)],
    );
  }

  getAllTransactions(from?: string, to?: string): Transaction[] {
    const clause = this.dateClause(from, to).replace(/^ AND/, " WHERE");
    return this.query(
      "SELECT payload FROM transactions" + clause + " ORDER BY booked_at DESC",
      this.dateParams(from, to),
    );
  }

  private query(sql: string, params: (string | null)[]): Transaction[] {
    const rows = this.db.prepare(sql).all(...params) as { payload: Uint8Array }[];
    return rows.map((r) => this.cipher.decryptJson<Transaction>(Buffer.from(r.payload)));
  }

  // booked_at is an ISO date, so lexicographic comparison is chronological.
  private dateClause(from?: string, to?: string): string {
    return (from ? " AND booked_at >= ?" : "") + (to ? " AND booked_at <= ?" : "");
  }

  private dateParams(from?: string, to?: string): string[] {
    return [from, to].filter((v): v is string => Boolean(v));
  }

  // --- transaction labels (data enrichment) ---
  // Keyed by a hash of the exact transaction text so upserts are addressable
  // without putting the text in the clear; the label itself lives in the
  // encrypted payload.

  private textHash(text: string): string {
    return createHash("sha256").update(text).digest("hex");
  }

  upsertTransactionLabels(labels: TransactionLabel[]): void {
    const stmt = this.db.prepare(
      "INSERT INTO transaction_labels (text_hash, payload) VALUES (?, ?) " +
        "ON CONFLICT(text_hash) DO UPDATE SET payload = excluded.payload",
    );
    for (const label of labels) {
      stmt.run(this.textHash(label.text), this.cipher.encryptJson(label));
    }
  }

  getTransactionLabels(): TransactionLabel[] {
    const rows = this.db.prepare("SELECT payload FROM transaction_labels").all() as {
      payload: Uint8Array;
    }[];
    return rows.map((r) => this.cipher.decryptJson<TransactionLabel>(Buffer.from(r.payload)));
  }

  // --- sync bookkeeping ---

  getLastSyncedAt(accountId: string): string | undefined {
    const row = this.db
      .prepare("SELECT last_synced_at FROM sync_meta WHERE account_id = ?")
      .get(accountId) as { last_synced_at: string } | undefined;
    return row?.last_synced_at;
  }

  setLastSyncedAt(accountId: string, isoTimestamp: string): void {
    this.db
      .prepare(
        "INSERT INTO sync_meta (account_id, last_synced_at) VALUES (?, ?) " +
          "ON CONFLICT(account_id) DO UPDATE SET last_synced_at = excluded.last_synced_at",
      )
      .run(accountId, isoTimestamp);
  }

  close(): void {
    this.db.close();
  }
}
