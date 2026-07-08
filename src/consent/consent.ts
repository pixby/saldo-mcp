import type { Institution } from "../domain/types.js";
import type { Entitlement } from "../broker-client.js";

/** A bank connection the user has established (one consent session). */
export interface ConnectedSession {
  sessionId: string;
  institutionId: string;
  /** ISO timestamp the consent expires, if known. */
  validUntil?: string;
  accountIds: string[];
}

/** True if a consent's validUntil is in the past. */
export function isExpired(validUntil: string | undefined, now = Date.now()): boolean {
  return Boolean(validUntil) && new Date(validUntil!).getTime() < now;
}

/**
 * How consent + "which accounts are linked" is handled. The engine delegates to
 * one of these so the same data/cache/MCP code serves both modes:
 *  - self-host: local loopback callback + provider `/sessions`, state in a file.
 *  - managed: the broker runs consent + holds sessions; the app polls it.
 */
export interface ConsentStrategy {
  listInstitutions(country: string): Promise<Institution[]>;

  /** Run the bank-authorization flow; `openUrl` opens the returned auth URL. */
  link(
    institutionId: string,
    openUrl: (url: string) => void | Promise<void>,
  ): Promise<{ accountIds: string[] }>;

  /** Account ids from live (non-expired) sessions, de-duplicated. */
  accountIds(): Promise<string[]>;

  /** All connected sessions (including expired, so the UI can prompt re-link). */
  listSessions(): Promise<ConnectedSession[]>;

  /** Remove a connection: drop it locally and best-effort revoke it at the provider. */
  disconnect(sessionId: string): Promise<void>;

  /** Subscription/trial state, where a broker is involved. Self-host has no
   *  billing, so these are optional; the engine substitutes "unlimited". */
  entitlement?(): Promise<Entitlement>;
  createCheckout?(plan: "individual" | "business"): Promise<{ url: string }>;

  /** Restore an existing subscription onto this device by proving ownership
   *  of the email it was bought with (managed mode only). */
  restoreStart?(email: string): Promise<void>;
  restoreVerify?(email: string, code: string): Promise<{ email: string; entitlement: Entitlement }>;
}

/** Re-exported billing shape (defined next to the broker client contract). */
export type { Entitlement } from "../broker-client.js";
