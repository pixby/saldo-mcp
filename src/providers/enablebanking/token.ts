import { signAppJwt } from "./jwt.js";

/**
 * Supplies the bearer token for Enable Banking data calls. This is the seam
 * between self-host and managed mode:
 *  - self-host: sign an app JWT locally with the owner's EB private key.
 *  - managed: fetch a short-lived JWT from the broker (which holds the key).
 * Either way the app calls Enable Banking directly with the token — data never
 * flows through the broker.
 */
export type TokenProvider = (forceRefresh?: boolean) => Promise<string>;

/** Local signer: mints and caches an app JWT from the EB private key. */
export function localTokenProvider(
  applicationId: string,
  privateKey: string,
  ttl = 3600,
): TokenProvider {
  let cached: { jwt: string; exp: number } | undefined;
  return async (force = false) => {
    const now = Math.floor(Date.now() / 1000);
    if (force || !cached || cached.exp - 60 <= now) {
      cached = { jwt: signAppJwt(applicationId, privateKey, ttl), exp: now + ttl };
    }
    return cached.jwt;
  };
}
