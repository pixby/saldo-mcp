import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { writeFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { loadConfig, ConfigError } from "../dist/config.js";
import { tempDir } from "./helpers.mjs";

/** loadConfig reads process.env + <dataDir>/config.json — reset both per test. */
const ENV_KEYS = ["SALDO_DATA_DIR", "SALDO_BROKER_URL", "EB_APPLICATION_ID", "EB_PRIVATE_KEY", "EB_REDIRECT_URL"];
beforeEach(() => {
  for (const k of ENV_KEYS) delete process.env[k];
});

async function withSaved(saved) {
  const dir = await tempDir("saldo-cfg-");
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, "config.json"), JSON.stringify(saved));
  process.env.SALDO_DATA_DIR = dir;
  return dir;
}

test("no env and no file → ConfigError pointing at saldo init", async () => {
  process.env.SALDO_DATA_DIR = await tempDir("saldo-cfg-");
  assert.throws(() => loadConfig(), ConfigError);
  assert.throws(() => loadConfig(), /saldo init/);
});

test("selfhost from saved file, with \\n-escaped PEM un-escaped", async () => {
  await withSaved({
    mode: "selfhost",
    applicationId: "app-123",
    privateKey: "-----BEGIN PRIVATE KEY-----\\nabc\\n-----END PRIVATE KEY-----\\n",
    redirectUrl: "https://localhost:9999/callback",
  });
  const config = loadConfig();
  assert.equal(config.mode, "selfhost");
  assert.equal(config.enablebanking.applicationId, "app-123");
  assert.match(config.enablebanking.privateKey, /-----BEGIN PRIVATE KEY-----\nabc\n/);
  assert.equal(config.redirectUrl, "https://localhost:9999/callback");
});

test("managed from saved file", async () => {
  await withSaved({ mode: "managed", brokerUrl: "https://broker.example" });
  const config = loadConfig();
  assert.equal(config.mode, "managed");
  assert.equal(config.brokerUrl, "https://broker.example");
});

test("environment wins over the saved file", async () => {
  await withSaved({ mode: "managed", brokerUrl: "https://file-broker.example" });
  process.env.SALDO_BROKER_URL = "https://env-broker.example";
  assert.equal(loadConfig().brokerUrl, "https://env-broker.example");

  // Env selfhost credentials beat a managed file config entirely.
  process.env.EB_APPLICATION_ID = "env-app";
  process.env.EB_PRIVATE_KEY = "-----BEGIN PRIVATE KEY-----\\nx\\n-----END PRIVATE KEY-----";
  delete process.env.SALDO_BROKER_URL;
  const config = loadConfig();
  assert.equal(config.mode, "selfhost");
  assert.equal(config.enablebanking.applicationId, "env-app");
});
