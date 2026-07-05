import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createEngine } from "./bootstrap.js";
import { buildMcpServer } from "./mcp/server.js";

/**
 * Entry point for the MCP server over stdio — the standard way an MCP client
 * (Claude Desktop etc.) launches and talks to a local server. The desktop app
 * instead hosts the Streamable HTTP transport (mcp/http.ts); the tool surface
 * in mcp/server.ts is identical either way.
 *
 * stdout is reserved for the MCP protocol, so all logging goes to stderr.
 */
async function main(): Promise<void> {
  const engine = await createEngine();
  const server = buildMcpServer(engine);
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error(`[saldo] MCP server ready (provider: ${engine.providerId}).`);
}

main().catch((err) => {
  console.error("[saldo] failed to start:", err instanceof Error ? err.message : err);
  process.exit(1);
});
