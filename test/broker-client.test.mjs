import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { BrokerClient } from "../dist/broker-client.js";
import { tempDir } from "./helpers.mjs";

/** Minimal fake broker: accepts only VALID device credentials, 401s the rest. */
function fakeBroker(valid) {
  const state = { registrations: 0, log: [] };
  const server = createServer((req, res) => {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      state.log.push(`${req.method} ${req.url} dev=${req.headers["x-device-id"] ?? "-"}`);
      if (req.method === "POST" && req.url === "/v1/devices") {
        state.registrations++;
        res.writeHead(201, { "content-type": "application/json" });
        return res.end(JSON.stringify(valid));
      }
      if (req.headers["x-device-id"] !== valid.deviceId) {
        res.writeHead(401, { "content-type": "application/json" });
        return res.end(JSON.stringify({ error: "Invalid device credentials" }));
      }
      if (req.url?.startsWith("/v1/institutions")) {
        res.writeHead(200, { "content-type": "application/json" });
        return res.end(JSON.stringify({ institutions: [{ id: "SE:Testbanken", name: "Testbanken" }] }));
      }
      res.writeHead(404);
      res.end();
    });
  });
  return { server, state };
}

function listen(server) {
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => resolve(`http://127.0.0.1:${server.address().port}`));
  });
}

test("first run registers a device and persists it (0600)", async (t) => {
  const { server, state } = fakeBroker({ deviceId: "dev-1", deviceSecret: "sec-1" });
  t.after(() => server.close());
  const base = await listen(server);
  const dir = await tempDir();

  const client = new BrokerClient(base, dir);
  const institutions = await client.listInstitutions("SE");
  assert.equal(institutions[0].name, "Testbanken");
  assert.equal(state.registrations, 1);

  const persisted = JSON.parse(await readFile(join(dir, "broker-device.json"), "utf8"));
  assert.equal(persisted.deviceId, "dev-1");
});

test("stale device -> 401 -> re-registers once and retries", async (t) => {
  const { server, state } = fakeBroker({ deviceId: "dev-new", deviceSecret: "sec-new" });
  t.after(() => server.close());
  const base = await listen(server);
  const dir = await tempDir();
  // Seed a stale device, as left behind by a broker-side database reset.
  await writeFile(
    join(dir, "broker-device.json"),
    JSON.stringify({ deviceId: "dev-stale", deviceSecret: "sec-stale" }),
  );

  const client = new BrokerClient(base, dir);
  const institutions = await client.listInstitutions("SE");
  assert.equal(institutions[0].name, "Testbanken", "call succeeds after self-heal");
  assert.equal(state.registrations, 1, "exactly one re-registration");
  // The re-registration request itself must not carry the stale credentials.
  const registerLine = state.log.find((l) => l.includes("/v1/devices"));
  assert.match(registerLine, /dev=-$/);

  const persisted = JSON.parse(await readFile(join(dir, "broker-device.json"), "utf8"));
  assert.equal(persisted.deviceId, "dev-new", "fresh credentials persisted to disk");
});

test("persistent 401 fails fast instead of looping", async (t) => {
  let requests = 0;
  const server = createServer((req, res) => {
    requests++;
    if (req.method === "POST" && req.url === "/v1/devices") {
      res.writeHead(201, { "content-type": "application/json" });
      return res.end(JSON.stringify({ deviceId: "d", deviceSecret: "s" }));
    }
    res.writeHead(401, { "content-type": "application/json" });
    res.end(JSON.stringify({ error: "nope" }));
  });
  t.after(() => server.close());
  const base = await listen(server);
  const dir = await tempDir();

  const client = new BrokerClient(base, dir);
  await assert.rejects(() => client.listInstitutions("SE"), /401/);
  // register + call + re-register + retried call = 4; anything more is a loop.
  assert.ok(requests <= 4, `expected bounded retries, saw ${requests} requests`);
});
