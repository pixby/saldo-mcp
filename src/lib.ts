/**
 * Public library surface — what other packages in the monorepo (the Mac App)
 * import. Keeps consumers off deep paths so we can refactor internals freely.
 */
export { createEngine } from "./bootstrap.js";
export { Engine } from "./engine.js";
export { buildMcpServer } from "./mcp/server.js";
export { startHttpMcpServer } from "./mcp/http.js";
export type { HttpMcpHandle } from "./mcp/http.js";
export { loadConfig, ConfigError } from "./config.js";
export type { Config, Mode } from "./config.js";
export { formatMinor, formatMoney, toMinorUnits } from "./util/money.js";
export type {
  Account,
  Balance,
  Institution,
  Money,
  Transaction,
  TransactionStatus,
} from "./domain/types.js";
