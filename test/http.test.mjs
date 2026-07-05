import { test } from "node:test";
import assert from "node:assert/strict";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { startHttpMcpServer } from "../dist/mcp/http.js";
import { makeEngine } from "./helpers.mjs";

// The app-hosted transport: Streamable HTTP on loopback (Claude connects to it).
test("MCP over Streamable HTTP on loopback serves the tool surface", async () => {
  const { engine } = makeEngine(undefined);
  const port = 42000 + (process.pid % 1000);
  const handle = await startHttpMcpServer(engine, port);
  assert.equal(handle.url, `http://127.0.0.1:${port}/mcp`);

  const client = new Client({ name: "saldo-http-test", version: "0.0.0" });
  await client.connect(new StreamableHTTPClientTransport(new URL(handle.url)));

  const { tools } = await client.listTools();
  assert.equal(tools.length, 7);

  const result = await client.callTool({ name: "list_accounts", arguments: {} });
  const text = result.content.map((c) => c.text).join("\n");
  assert.match(text, /Lönekonto/);

  await client.close();
  await handle.close();
});

test("stateless server rejects session-oriented GET/DELETE verbs", async () => {
  const { engine } = makeEngine(undefined);
  const port = 43000 + (process.pid % 1000);
  const handle = await startHttpMcpServer(engine, port);
  const res = await fetch(handle.url);
  assert.equal(res.status, 405);
  await handle.close();
});
