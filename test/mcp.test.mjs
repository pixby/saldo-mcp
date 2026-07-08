import { test } from "node:test";
import assert from "node:assert/strict";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { buildMcpServer } from "../dist/mcp/server.js";
import { amt, makeEngine } from "./helpers.mjs";

/**
 * The MCP tool surface IS the product — these tests pin its shape and behavior
 * end-to-end through the real MCP SDK (client <-> server over linked in-memory
 * transports), against the fake provider.
 */

const EXPECTED_TOOLS = [
  "compare_periods",
  "get_balances",
  "get_recurring_charges",
  "get_transactions",
  "list_accounts",
  "search_transactions",
  "spending_by_category",
];

async function connectedClient() {
  const { engine } = makeEngine(undefined);
  const server = buildMcpServer(engine);
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "saldo-test", version: "0.0.0" });
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  return { client, server };
}

async function callText(client, name, args = {}) {
  const result = await client.callTool({ name, arguments: args });
  assert.equal(result.isError ?? false, false, `${name} should not error`);
  return result.content.map((c) => c.text).join("\n");
}

test("tool surface is exactly the seven read-only tools", async () => {
  const { client, server } = await connectedClient();
  const { tools } = await client.listTools();
  assert.deepEqual(tools.map((t) => t.name).sort(), EXPECTED_TOOLS);
  // Guardrail: read-only always. No tool name may suggest mutation and no
  // payment/transfer capability may ever appear — read-only is a hard product rule.
  for (const tool of tools) {
    assert.doesNotMatch(
      tool.name,
      /pay|transfer|send|create|write|update|delete|initiate/i,
      `tool "${tool.name}" suggests mutation`,
    );
  }
  await client.close();
  await server.close();
});

test("list_accounts lists the connected fixture accounts", async () => {
  const { client, server } = await connectedClient();
  const out = await callText(client, "list_accounts");
  assert.match(out, /Lönekonto/);
  assert.match(out, /acc_checking/);
  assert.match(out, /SE3550000000054910000003/);
  await client.close();
  await server.close();
});

test("get_balances formats amounts in kr at presentation", async () => {
  const { client, server } = await connectedClient();
  const out = await callText(client, "get_balances");
  assert.ok(out.includes(amt("12 345,67 kr"))); // 1234567 öre — öre internally, kr only at the edge
  assert.ok(out.includes(amt("500 000,00 kr")));
  const one = await callText(client, "get_balances", { account: "acc_savings" });
  assert.doesNotMatch(one, /acc_checking/);
  await client.close();
  await server.close();
});

test("get_transactions respects the date range and flags pending", async () => {
  const { client, server } = await connectedClient();
  const out = await callText(client, "get_transactions", {
    account: "acc_checking",
    from: "2025-06-01",
    to: "2025-06-30",
  });
  assert.ok(out.includes(`${amt("-119,00 kr")} · Spotify AB`));
  assert.match(out, /\[pending\]/); // t14, the pending SF Bio charge
  assert.doesNotMatch(out, /2025-05/, "May transactions excluded from a June range");
  await client.close();
  await server.close();
});

test("get_transactions without an account merges all connected accounts", async () => {
  const { client, server } = await connectedClient();
  const out = await callText(client, "get_transactions", { from: "2025-06-01", to: "2025-06-30" });
  assert.match(out, /Spotify AB/); // checking account
  assert.match(out, /Överföring sparande/); // savings account
  await client.close();
  await server.close();
});

test("get_transactions filters by absolute amount in kr", async () => {
  const { client, server } = await connectedClient();
  const out = await callText(client, "get_transactions", {
    account: "acc_checking",
    min_amount: 1000,
  });
  assert.match(out, /Wallenstam AB/); // rent, 8 500 kr
  assert.match(out, /Arbetsgivaren AB/); // salary inflow, 35 000 kr (absolute value counts)
  assert.doesNotMatch(out, /Spotify AB/); // 119 kr, filtered out
  const capped = await callText(client, "get_transactions", {
    account: "acc_checking",
    max_amount: 150,
  });
  assert.match(capped, /Spotify AB/);
  assert.doesNotMatch(capped, /Wallenstam AB/);
  await client.close();
  await server.close();
});

test("search_transactions matches counterparty and description, case-insensitive", async () => {
  const { client, server } = await connectedClient();
  const out = await callText(client, "search_transactions", { query: "ica" });
  assert.match(out, /ICA Supermarket Aptiten/);
  assert.doesNotMatch(out, /Spotify/);
  const byDescription = await callText(client, "search_transactions", { query: "hyra" });
  assert.match(byDescription, /Wallenstam AB/); // "Hyra juni" lives in the description
  const miss = await callText(client, "search_transactions", { query: "zzz-nothing" });
  assert.match(miss, /No transactions matching/);
  await client.close();
  await server.close();
});

test("spending_by_category can group by exact counterparty", async () => {
  const { client, server } = await connectedClient();
  const out = await callText(client, "spending_by_category", {
    period: "2025-06",
    group_by: "counterparty",
  });
  assert.match(out, /ICA Supermarket Aptiten/); // exact merchant, not "Groceries"
  assert.doesNotMatch(out, /Groceries/);
  await client.close();
  await server.close();
});

test("spending_by_category summarizes a YYYY-MM period", async () => {
  const { client, server } = await connectedClient();
  const out = await callText(client, "spending_by_category", { period: "2025-06" });
  assert.ok(out.includes(`Housing: ${amt("8 500,00 kr")} (1×)`));
  assert.ok(out.includes(`Groceries: ${amt("1 298,45 kr")} (3×)`));
  assert.doesNotMatch(out, /Income/, "inflows are not spending");
  await client.close();
  await server.close();
});

test("get_recurring_charges detects the monthly subscriptions", async () => {
  const { client, server } = await connectedClient();
  const out = await callText(client, "get_recurring_charges");
  assert.ok(out.includes(`Spotify AB: ~${amt("119,00 kr")} · 3× over 3 months`));
  assert.match(out, /Wallenstam AB/);
  await client.close();
  await server.close();
});

test("compare_periods reports spent/received/net for both periods", async () => {
  const { client, server } = await connectedClient();
  const out = await callText(client, "compare_periods", { a: "2025-05", b: "2025-06" });
  assert.ok(out.includes(`2025-05: spent ${amt("8 619,00 kr")}, received ${amt("35 000,00 kr")}`));
  assert.match(out, /2025-06: spent/);
  assert.match(out, /Δ spending:/);
  await client.close();
  await server.close();
});

test("onToolCall hook reports call metadata only — never arguments or results", async () => {
  const { engine } = makeEngine(undefined);
  const events = [];
  const server = buildMcpServer(engine, { onToolCall: (e) => events.push(e) });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "saldo-test", version: "0.0.0" });
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);

  await client.callTool({ name: "search_transactions", arguments: { query: "ica" } });
  assert.equal(events.length, 1);
  const event = events[0];
  assert.equal(event.tool, "search_transactions");
  assert.equal(event.ok, true);
  assert.equal(event.client, "saldo-test");
  assert.ok(event.durationMs >= 0);
  assert.ok(!Number.isNaN(Date.parse(event.startedAt)));
  // The privacy contract: nothing from the call's input or output may appear —
  // not the query string, not any transaction text from the result.
  const flat = JSON.stringify(event).toLowerCase();
  assert.doesNotMatch(flat, /ica/);
  assert.doesNotMatch(flat, /supermarket/);

  await client.close();
  await server.close();
});

test("a throwing onToolCall observer never breaks the tool call", async () => {
  const { engine } = makeEngine(undefined);
  const server = buildMcpServer(engine, {
    onToolCall: () => {
      throw new Error("observer boom");
    },
  });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "saldo-test", version: "0.0.0" });
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  const result = await client.callTool({ name: "list_accounts", arguments: {} });
  assert.equal(result.isError ?? false, false);
  assert.match(result.content[0].text, /Lönekonto/);
  await client.close();
  await server.close();
});

test("tools answer gracefully with no linked accounts", async () => {
  const { Engine } = await import("../dist/engine.js");
  const { FakeProvider, FakeConsent } = await import("./helpers.mjs");
  const engine = new Engine(new FakeProvider(), new FakeConsent([]), undefined);
  const server = buildMcpServer(engine);
  const [ct, st] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "saldo-test", version: "0.0.0" });
  await Promise.all([server.connect(st), client.connect(ct)]);
  const out = await callText(client, "list_accounts");
  assert.match(out, /No accounts connected/);
  await client.close();
  await server.close();
});
