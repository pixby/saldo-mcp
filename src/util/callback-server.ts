import { createServer as createHttpServer } from "node:http";
import { createServer as createHttpsServer, type Server } from "node:https";
import type { IncomingMessage, ServerResponse } from "node:http";
import selfsigned from "selfsigned";

/**
 * Captures the OAuth-style redirect for a bank-authorization flow.
 *
 * The provider sends the user's browser to the bank; on success the bank
 * redirects to our `redirect_url`, which points at a short-lived HTTP(S) server
 * on loopback. We pull the `code` (and verify `state`) out of that request. This
 * is how the headless connector and the Mac App both bind the browser session
 * back to the running process without a public server.
 *
 * The redirect URL must match what's registered in the provider application.
 * Enable Banking requires `https`, so when the URL is https we serve TLS with a
 * self-signed localhost certificate — the browser shows a one-time "not trusted"
 * warning the user clicks through (the request never leaves the machine).
 */
export interface CallbackServer {
  redirectUrl: string;
  /** Resolve with the `code` once the bank redirects back; rejects on timeout/error. */
  waitForCode(expectedState: string, timeoutMs?: number): Promise<string>;
  close(): Promise<void>;
}

export async function startCallbackServer(redirectUrl: string): Promise<CallbackServer> {
  const target = new URL(redirectUrl);
  const isHttps = target.protocol === "https:";
  const port = Number(target.port || (isHttps ? "443" : "80"));

  let resolveCode: (v: { code: string; state: string | null }) => void;
  let rejectCode: (err: Error) => void;
  const captured = new Promise<{ code: string; state: string | null }>((resolve, reject) => {
    resolveCode = resolve;
    rejectCode = reject;
  });

  const handler = (req: IncomingMessage, res: ServerResponse) => {
    const reqUrl = new URL(req.url ?? "/", `http://${target.host}`);
    if (reqUrl.pathname !== target.pathname) {
      res.writeHead(404);
      res.end();
      return;
    }
    const code = reqUrl.searchParams.get("code");
    const error = reqUrl.searchParams.get("error");
    res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    res.end(
      `<!doctype html><meta charset="utf-8"><body style="font-family:sans-serif;padding:2rem">` +
        (code
          ? "<h2>Saldo</h2><p>Bank connected. You can close this window.</p>"
          : `<h2>Saldo</h2><p>Authorization failed${error ? `: ${error}` : ""}.</p>`) +
        "</body>",
    );
    if (code) resolveCode({ code, state: reqUrl.searchParams.get("state") });
    else rejectCode(new Error(error ?? "No authorization code in callback."));
  };

  const server: Server = isHttps
    ? createHttpsServer(selfSignedTls(), handler)
    : (createHttpServer(handler) as unknown as Server);

  await new Promise<void>((resolve) => server.listen(port, "127.0.0.1", resolve));

  return {
    redirectUrl,
    async waitForCode(expectedState, timeoutMs = 300_000) {
      let timer: NodeJS.Timeout;
      const timeout = new Promise<never>((_, reject) => {
        timer = setTimeout(
          () => reject(new Error("Timed out waiting for bank authorization.")),
          timeoutMs,
        );
      });
      try {
        const { code, state } = await Promise.race([captured, timeout]);
        if (expectedState && state !== expectedState) {
          throw new Error("Authorization state mismatch — aborting for safety.");
        }
        return code;
      } finally {
        clearTimeout(timer!);
      }
    },
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}

/** A fresh self-signed cert valid for localhost / 127.0.0.1, for the loopback TLS server. */
function selfSignedTls(): { key: string; cert: string } {
  const pems = selfsigned.generate([{ name: "commonName", value: "localhost" }], {
    days: 365,
    keySize: 2048,
    algorithm: "sha256",
    extensions: [
      {
        name: "subjectAltName",
        altNames: [
          { type: 2, value: "localhost" }, // DNS
          { type: 7, ip: "127.0.0.1" }, // IP
        ],
      },
    ],
  });
  return { key: pems.private, cert: pems.cert };
}
