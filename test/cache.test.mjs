import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { Cache } from "../dist/cache/cache.js";
import { Cipher, loadOrCreateKey } from "../dist/cache/crypto.js";
import { ACCOUNTS, TRANSACTIONS, CHECKING, SAVINGS, tempDir } from "./helpers.mjs";

test("cipher round-trips JSON and detects tampering", async () => {
  const dir = await tempDir();
  const cipher = new Cipher(await loadOrCreateKey(dir));
  const value = { name: "Lönekonto", amountMinor: -123456 };
  const blob = cipher.encryptJson(value);
  assert.deepEqual(cipher.decryptJson(blob), value);
  // Flip one ciphertext byte: GCM's auth tag must reject it.
  blob[blob.length - 1] ^= 0xff;
  assert.throws(() => cipher.decryptJson(blob));
});

test("loadOrCreateKey persists a 32-byte key and reuses it", async () => {
  const dir = await tempDir();
  const first = await loadOrCreateKey(dir);
  const second = await loadOrCreateKey(dir);
  assert.equal(first.length, 32);
  assert.deepEqual(first, second);
});

test("cache round-trips accounts and transactions", async () => {
  const dir = await tempDir();
  const cache = await Cache.open(join(dir, "cache.db"), dir);
  cache.upsertAccounts(ACCOUNTS);
  cache.upsertTransactions(TRANSACTIONS);

  assert.deepEqual(
    cache.getAccounts().sort((a, b) => a.id.localeCompare(b.id)),
    [...ACCOUNTS].sort((a, b) => a.id.localeCompare(b.id)),
  );
  const all = cache.getAllTransactions();
  assert.equal(all.length, TRANSACTIONS.length);
  cache.close();
});

test("cache date-range queries are inclusive and per-account", async () => {
  const dir = await tempDir();
  const cache = await Cache.open(join(dir, "cache.db"), dir);
  cache.upsertTransactions(TRANSACTIONS);

  const june = cache.getTransactions(CHECKING, "2025-06-01", "2025-06-30");
  assert.ok(june.length > 0);
  assert.ok(june.every((t) => t.accountId === CHECKING));
  assert.ok(june.every((t) => t.bookedAt >= "2025-06-01" && t.bookedAt <= "2025-06-30"));
  // Boundary dates are included (t03 booked exactly 2025-06-01).
  assert.ok(june.some((t) => t.id === "t03"));
  // Ordered newest first.
  const dates = june.map((t) => t.bookedAt);
  assert.deepEqual(dates, [...dates].sort().reverse());

  const savingsOnly = cache.getTransactions(SAVINGS);
  assert.deepEqual(savingsOnly.map((t) => t.id), ["t13"]);
  cache.close();
});

test("upsert is idempotent — re-syncing the same data does not duplicate", async () => {
  const dir = await tempDir();
  const cache = await Cache.open(join(dir, "cache.db"), dir);
  cache.upsertTransactions(TRANSACTIONS);
  cache.upsertTransactions(TRANSACTIONS);
  assert.equal(cache.getAllTransactions().length, TRANSACTIONS.length);
  cache.close();
});

test("sensitive fields never hit the database file in plaintext", async () => {
  const dir = await tempDir();
  const dbPath = join(dir, "cache.db");
  const cache = await Cache.open(dbPath, dir);
  cache.upsertAccounts(ACCOUNTS);
  cache.upsertTransactions(TRANSACTIONS);
  cache.close();

  const raw = await readFile(dbPath);
  for (const secret of ["Lönekonto", "Spotify", "ICA", "Arbetsgivaren", "SE3550000000054910000003"]) {
    assert.ok(!raw.includes(Buffer.from(secret, "utf8")), `"${secret}" must not appear in cleartext`);
  }
  // The only cleartext columns are ids and booking dates (queryable by design).
  assert.ok(raw.includes(Buffer.from("2025-06-10", "utf8")));
});

test("sync bookkeeping stores last-synced timestamps per account", async () => {
  const dir = await tempDir();
  const cache = await Cache.open(join(dir, "cache.db"), dir);
  assert.equal(cache.getLastSyncedAt(CHECKING), undefined);
  cache.setLastSyncedAt(CHECKING, "2025-06-30T12:00:00Z");
  cache.setLastSyncedAt(CHECKING, "2025-07-01T12:00:00Z"); // upsert wins
  assert.equal(cache.getLastSyncedAt(CHECKING), "2025-07-01T12:00:00Z");
  assert.equal(cache.getLastSyncedAt(SAVINGS), undefined);
  cache.close();
});
