import { sign } from "node:crypto";

/**
 * Enable Banking authenticates the *application* with a short-lived RS256 JWT
 * signed by the application's RSA private key. The token only identifies the app
 * (not a user); user/bank authorization is a separate session flow.
 *
 * Header: { typ:"JWT", alg:"RS256", kid: <applicationId> }
 * Claims: { iss:"enablebanking.com", aud:"api.enablebanking.com", iat, exp }
 * Max TTL is 24h; we use 1h and regenerate as needed.
 *
 * Implemented with node:crypto directly — no JWT library dependency.
 */
export function signAppJwt(
  applicationId: string,
  privateKeyPem: string,
  ttlSeconds = 3600,
): string {
  const now = Math.floor(Date.now() / 1000);
  const header = { typ: "JWT", alg: "RS256", kid: applicationId };
  const payload = {
    iss: "enablebanking.com",
    aud: "api.enablebanking.com",
    iat: now,
    exp: now + ttlSeconds,
  };
  const encode = (obj: unknown) => Buffer.from(JSON.stringify(obj)).toString("base64url");
  const signingInput = `${encode(header)}.${encode(payload)}`;
  const signature = sign("RSA-SHA256", Buffer.from(signingInput), privateKeyPem).toString(
    "base64url",
  );
  return `${signingInput}.${signature}`;
}
