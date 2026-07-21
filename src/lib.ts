/**
 * Public library surface — what embedders (like the Saldo Mac app) import.
 * Keeps consumers off deep paths so internals can be refactored freely.
 */
export { createEngine } from "./bootstrap.js";
export { Engine } from "./engine.js";
export { buildMcpServer } from "./mcp/server.js";
export type { McpServerOptions, ToolCallEvent } from "./mcp/server.js";
export { startHttpMcpServer } from "./mcp/http.js";
export type { HttpMcpHandle } from "./mcp/http.js";
export { loadConfig, ConfigError } from "./config.js";
export type { Config, Mode } from "./config.js";
export type { Entitlement } from "./broker-client.js";
export { formatMinor, formatMoney, toMinorUnits } from "./util/money.js";
export { CATEGORIES, transactionText } from "./labels.js";
export type { Category, TransactionLabel } from "./labels.js";
export type {
  Account,
  Balance,
  Institution,
  Money,
  Transaction,
  TransactionKind,
  TransactionStatus,
} from "./domain/types.js";
