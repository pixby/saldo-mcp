import { test } from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";
import { Cache } from "../dist/cache/cache.js";
import { Engine } from "../dist/engine.js";
import {
  FakeConsent,
  FakeProvider,
  makeEngine,
  recentTransactions,
  tempDir,
  CHECKING,
  SAVINGS,
  TRANSACTIONS,
} from "./helpers.mjs";

// Cached-path tests use recent fixture dates: Engine.sync() requests a rolling
// 90-day window, so the static 2025 fixtures would fall outside it.
async function cachedEngine() {
  const dir = await tempDir();
  const cache = await Cache.open(join(dir, "cache.db"), dir);
  return { cache, ...makeEngine(cache, new FakeProvider(recentTransactions())) };
}

test("without a cache, reads pass through to the provider", async () => {
  const { engine, provider } = makeEngine(undefined);
  const txs = await engine.getTransactions(CHECKING);
  assert.equal(txs.length, TRANSACTIONS.filter((t) => t.accountId === CHECKING).length);
  await engine.getTransactions(CHECKING);
  assert.equal(provider.calls.getTransactions, 2, "no cache -> every read hits the provider");
  assert.deepEqual(await engine.sync(), { accounts: 0, transactions: 0 });
});

test("with a cache, first read lazily syncs and later reads stay local", async () => {
  const { engine, provider, cache } = await cachedEngine();
  const first = await engine.getTransactions(CHECKING);
  assert.ok(first.length > 0);
  const callsAfterFirst = provider.calls.getTransactions;
  assert.ok(callsAfterFirst >= 1);

  await engine.getTransactions(CHECKING);
  await engine.getTransactions(CHECKING, "2025-06-01", "2025-06-30");
  assert.equal(
    provider.calls.getTransactions,
    callsAfterFirst,
    "reads after the lazy sync must be served from the cache",
  );
  cache.close();
});

test("sync() pulls all linked accounts and reports counts", async () => {
  const { engine, provider, cache } = await cachedEngine();
  const result = await engine.sync();
  assert.equal(result.accounts, 2);
  assert.ok(result.transactions > 0);
  assert.equal(provider.calls.getAccount, 2);
  // listAccounts is now served from cache without provider calls.
  const before = provider.calls.getAccount;
  const accounts = await engine.listAccounts();
  assert.equal(accounts.length, 2);
  assert.equal(provider.calls.getAccount, before);
  cache.close();
});

test("a warm cache never hides accounts a new consent added", async () => {
  const dir = await tempDir();
  const cache = await Cache.open(join(dir, "cache.db"), dir);
  const provider = new FakeProvider(recentTransactions());
  const engine = new Engine(provider, new FakeConsent([CHECKING]), cache);
  await engine.sync();
  assert.equal((await engine.listAccounts()).length, 1);

  // Re-linking the bank mints an account id the cache has never seen.
  const relinked = new Engine(provider, new FakeConsent([CHECKING, SAVINGS]), cache);
  const before = provider.calls.getAccount;
  const accounts = await relinked.listAccounts();
  assert.equal(accounts.length, 2, "the fresh account must appear despite the warm cache");
  assert.equal(provider.calls.getAccount, before + 1, "only the missing account is fetched");
  // ...and it is cached now, so the next read stays local.
  await relinked.listAccounts();
  assert.equal(provider.calls.getAccount, before + 1);
  cache.close();
});

test("getAllTransactions merges accounts sorted newest-first", async () => {
  const { engine, cache } = await cachedEngine();
  await engine.sync();
  const all = await engine.getAllTransactions();
  const dates = all.map((t) => t.bookedAt ?? "");
  assert.deepEqual(dates, [...dates].sort().reverse());
  assert.ok(new Set(all.map((t) => t.accountId)).size > 1);
  cache.close();
});

test("balances are always fetched live, never cached", async () => {
  const { engine, provider, cache } = await cachedEngine();
  await engine.getBalances();
  await engine.getBalances();
  assert.equal(provider.calls.getBalances, 4, "2 accounts x 2 reads, no caching");
  cache.close();
});

test("applyLabels stores assistant labels for known texts and rejects the rest", async () => {
  const { engine, cache } = await cachedEngine();
  await engine.sync();
  // Distinct outflow texts in the recent fixtures: "Spotify AB" (3 rows) + ICA.
  assert.deepEqual(await engine.enrichmentStatus(), { labeled: 0, unlabeled: 2 });

  const result = await engine.applyLabels(
    [
      { text: "Spotify AB", category: "Subscriptions" },
      { text: "NOT IN THE CACHE", category: "Dining" }, // unknown text → rejected
      { text: "ICA Supermarket Aptiten", category: "Not-a-category" }, // bad category → rejected
    ],
    "assistant:test",
  );
  assert.equal(result.stored, 1);
  assert.deepEqual(result.rejected, ["NOT IN THE CACHE", "ICA Supermarket Aptiten"]);
  assert.deepEqual(await engine.enrichmentStatus(), { labeled: 1, unlabeled: 1 });
  assert.equal(engine.transactionLabels().get("Spotify AB"), "Subscriptions");

  // Relabeling the same text replaces the label — that's how corrections work.
  await engine.applyLabels([{ text: "Spotify AB", category: "Entertainment" }]);
  assert.equal(engine.transactionLabels().get("Spotify AB"), "Entertainment");
  assert.deepEqual(await engine.enrichmentStatus(), { labeled: 1, unlabeled: 1 });
  cache.close();
});

test("labeling needs the cache: status is empty and applyLabels refuses without one", async () => {
  const { engine } = makeEngine(undefined);
  assert.deepEqual(await engine.enrichmentStatus(), { labeled: 0, unlabeled: 0 });
  await assert.rejects(engine.applyLabels([{ text: "X", category: "Dining" }]), /cache/);
});

test("consentStatus flags sessions expiring within the window", async () => {
  const { engine } = makeEngine(undefined);
  const status = await engine.consentStatus(365 * 10); // huge window -> expiring
  assert.equal(status.length, 1);
  assert.equal(status[0].expiringSoon, true);
  const relaxed = await engine.consentStatus(1); // tiny window -> fine
  assert.equal(relaxed[0].expiringSoon, false);
});
