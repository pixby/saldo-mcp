import express from "express";
import type { Server } from "node:http";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import type { Engine } from "../engine.js";
import { buildMcpServer, type McpServerOptions } from "./server.js";

/**
 * Host the read-only MCP server over Streamable HTTP, bound to loopback only.
 *
 * This is the transport the Mac App uses: the app is a long-running process, so
 * Claude connects *to* this endpoint (via an mcp-remote shim) rather than
 * launching the server itself. Self-hosters keep using the stdio entry (index.ts).
 *
 * Stateless mode (one server+transport per request) — fine for a single local
 * user, and it means no session bookkeeping.
 */

export interface HttpMcpHandle {
  port: number;
  url: string;
  close(): Promise<void>;
}

export async function startHttpMcpServer(
  engine: Engine,
  port = 4321,
  options: McpServerOptions = {},
): Promise<HttpMcpHandle> {
  const app = express();
  app.use(express.json());

  app.post("/mcp", async (req, res) => {
    try {
      const server = buildMcpServer(engine, options);
      const transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: undefined, // stateless
      });
      res.on("close", () => {
        void transport.close();
        void server.close();
      });
      await server.connect(transport);
      await transport.handleRequest(req, res, req.body);
    } catch (err) {
      if (!res.headersSent) {
        res.status(500).json({
          jsonrpc: "2.0",
          error: { code: -32603, message: err instanceof Error ? err.message : "Internal error" },
          id: null,
        });
      }
    }
  });

  // Stateless server initiates no streams; reject the session-oriented verbs cleanly.
  const methodNotAllowed = (_req: express.Request, res: express.Response) =>
    res.status(405).json({
      jsonrpc: "2.0",
      error: { code: -32000, message: "Method not allowed (stateless server)." },
      id: null,
    });
  app.get("/mcp", methodNotAllowed);
  app.delete("/mcp", methodNotAllowed);

  const httpServer: Server = await new Promise((resolve) => {
    const s = app.listen(port, "127.0.0.1", () => resolve(s));
  });

  return {
    port,
    url: `http://127.0.0.1:${port}/mcp`,
    close: () => new Promise<void>((resolve) => httpServer.close(() => resolve())),
  };
}
