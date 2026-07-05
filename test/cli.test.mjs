import { test } from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
  connectToClaude,
  disconnectFromClaude,
  isConnectedToClaude,
  stdioServerPath,
} from "../dist/util/claude-config.js";
import { tempDir } from "./helpers.mjs";

const exec = promisify(execFile);
const CLI = new URL("../dist/cli/index.js", import.meta.url).pathname;

test("saldo init --managed writes config.json non-interactively", async () => {
  const dir = await tempDir("saldo-cli-");
  const { stdout } = await exec(process.execPath, [CLI, "init", "--managed"], {
    env: { ...process.env, SALDO_DATA_DIR: dir },
  });
  assert.match(stdout, /Wrote .*config\.json \(managed mode\)/);
  const cfg = JSON.parse(await readFile(join(dir, "config.json"), "utf8"));
  assert.equal(cfg.mode, "managed");
  assert.ok(cfg.brokerUrl);

  // Refuses to clobber without --force; overwrites with it.
  await assert.rejects(
    () => exec(process.execPath, [CLI, "init", "--managed"], { env: { ...process.env, SALDO_DATA_DIR: dir } }),
    /--force/,
  );
  await exec(process.execPath, [CLI, "init", "--managed", "--force"], {
    env: { ...process.env, SALDO_DATA_DIR: dir },
  });
});

test("saldo init --selfhost accepts a key file path and stores the PEM", async () => {
  const dir = await tempDir("saldo-cli-");
  const pemFile = join(dir, "key.pem");
  await writeFile(pemFile, "-----BEGIN PRIVATE KEY-----\nabc\n-----END PRIVATE KEY-----\n");
  await exec(
    process.execPath,
    [CLI, "init", "--selfhost", "--app-id", "app-1", "--key", pemFile],
    { env: { ...process.env, SALDO_DATA_DIR: dir } },
  );
  const cfg = JSON.parse(await readFile(join(dir, "config.json"), "utf8"));
  assert.equal(cfg.mode, "selfhost");
  assert.equal(cfg.applicationId, "app-1");
  assert.match(cfg.privateKey, /BEGIN PRIVATE KEY/);
});

test("connect-claude registers a stdio entry and preserves other servers", async () => {
  const dir = await tempDir("saldo-claude-");
  const path = join(dir, "claude_desktop_config.json");
  await writeFile(path, JSON.stringify({ mcpServers: { other: { command: "x" } } }));

  assert.equal(await isConnectedToClaude(path), false);
  const result = await connectToClaude(path);
  assert.equal(result.path, path);
  assert.equal(await isConnectedToClaude(path), true);

  const cfg = JSON.parse(await readFile(path, "utf8"));
  assert.ok(cfg.mcpServers.other, "pre-existing servers preserved");
  assert.equal(cfg.mcpServers.saldo.command, process.execPath);
  assert.deepEqual(cfg.mcpServers.saldo.args, [stdioServerPath()]);

  await disconnectFromClaude(path);
  assert.equal(await isConnectedToClaude(path), false);
  assert.ok(JSON.parse(await readFile(path, "utf8")).mcpServers.other, "others survive disconnect");
});

test("saldo doctor reports missing config with a pointer to init", async () => {
  const dir = await tempDir("saldo-cli-");
  const env = { ...process.env, SALDO_DATA_DIR: dir };
  delete env.SALDO_BROKER_URL;
  delete env.EB_APPLICATION_ID;
  delete env.EB_PRIVATE_KEY;
  const { stdout } = await exec(process.execPath, [CLI, "doctor"], { env }).catch((e) => e);
  assert.match(stdout, /✗ .*No configuration found/);
  assert.match(stdout, /saldo init/);
});
