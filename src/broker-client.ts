import { request as httpRequest } from "node:http";
import { request as httpsRequest } from "node:https";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { Institution } from "./domain/types.js";
import type { ConnectedSession } from "./consent/consent.js";

/**
 * Client for the Saldo broker (managed mode). The app registers a device once,
 * then uses the broker to run consent and to mint short-lived Enable Banking
 * JWTs — which the app uses to call Enable Banking *directly* for data.
 *
 * Device credentials persist in the data dir. Talks plain node:http(s) so it can
 * accept the broker's self-signed cert on localhost during local development.
 */
export interface BrokerAccount {
  uid: string;
  name?: string;
  currency?: string;
  iban?: string;
}

/** What the broker says this device may do (subscription state). The free
 *  trial is a Polar subscription in its trial period — `trialing: true`. */
export interface Entitlement {
  status: "subscribed" | "unsubscribed" | "unlimited";
  plan: "individual" | "business";
  trialing?: boolean;
  currentPeriodEnd?: string | null;
}

export class BrokerClient {
  private readonly deviceFile: string;
  private device?: { deviceId: string; deviceSecret: string };
  private token?: { token: string; expiresAt: number };

  constructor(
    private readonly baseUrl: string,
    dataDir: string,
  ) {
    this.deviceFile = join(dataDir, "broker-device.json");
  }

  /** Load or register this device with the broker. Idempotent. */
  async ensureDevice(): Promise<void> {
    if (this.device) return;
    try {
      this.device = JSON.parse(await readFile(this.deviceFile, "utf8"));
      return;
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
    }
    await this.registerDevice();
  }

  async listInstitutions(country: string): Promise<Institution[]> {
    const data = await this.authed<{ institutions: Institution[] }>(
      "GET",
      `/v1/institutions?country=${encodeURIComponent(country)}`,
    );
    return data.institutions;
  }

  /** Start consent; returns the URL the user opens for BankID. */
  async authStart(institutionId: string): Promise<{ authUrl: string }> {
    return this.authed("POST", "/v1/auth/start", { institutionId });
  }

  async listAccounts(): Promise<{ accounts: BrokerAccount[] }> {
    return this.authed("GET", "/v1/accounts");
  }

  async listSessions(): Promise<ConnectedSession[]> {
    const { sessions } = await this.authed<{ sessions: ConnectedSession[] }>("GET", "/v1/sessions");
    return sessions;
  }

  async disconnect(sessionId: string): Promise<void> {
    await this.authed("DELETE", `/v1/sessions/${encodeURIComponent(sessionId)}`);
  }

  /** A short-lived Enable Banking JWT to call EB directly. Cached until expiry. */
  async entitlement(): Promise<Entitlement> {
    const { entitlement } = await this.authed<{ entitlement: Entitlement }>(
      "GET",
      "/v1/entitlement",
    );
    return entitlement;
  }

  /** Hosted checkout URL for upgrading this device's subscription. */
  async createCheckout(plan: "individual" | "business"): Promise<{ url: string }> {
    return this.authed<{ url: string }>("POST", "/v1/billing/checkout", { plan });
  }

  /** Ask the broker to email a subscription-restore code. The broker answers
   *  the same way whether or not the email has an account. */
  async restoreStart(email: string): Promise<void> {
    await this.authed("POST", "/v1/restore/start", { email });
  }

  /** Verify an emailed restore code. On success the broker attaches this
   *  device to the account and the entitlement reflects the restored
   *  subscription. Codes are short-lived and single-use. */
  async restoreVerify(
    email: string,
    code: string,
  ): Promise<{ email: string; entitlement: Entitlement }> {
    return this.authed("POST", "/v1/restore/verify", { email, code });
  }

  async getToken(force = false): Promise<string> {
    const now = Math.floor(Date.now() / 1000);
    if (force || !this.token || this.token.expiresAt - 60 <= now) {
      this.token = await this.authed<{ token: string; expiresAt: number }>("GET", "/v1/token");
    }
    return this.token.token;
  }

  /** Register a fresh device and persist its credentials. */
  private async registerDevice(): Promise<void> {
    this.device = undefined; // no stale credentials on the registration call itself
    this.device = await this.json<{ deviceId: string; deviceSecret: string }>(
      "POST",
      "/v1/devices",
    );
    await mkdir(dirname(this.deviceFile), { recursive: true });
    await writeFile(this.deviceFile, JSON.stringify(this.device), { mode: 0o600 });
  }

  /**
   * Authenticated broker call that self-heals a stale device: on a 401
   * (broker DB reset, device revoked), discard the stored credentials,
   * re-register once, and retry the original request. Bounded to a single
   * re-registration so a genuine auth failure can't loop.
   */
  private async authed<T>(method: string, path: string, body?: unknown): Promise<T> {
    await this.ensureDevice();
    try {
      return await this.json<T>(method, path, body);
    } catch (err) {
      if ((err as { status?: number }).status !== 401) throw err;
      this.token = undefined;
      await rm(this.deviceFile, { force: true });
      await this.registerDevice();
      return this.json<T>(method, path, body);
    }
  }

  private async json<T>(method: string, path: string, body?: unknown): Promise<T> {
    const url = new URL(this.baseUrl + path);
    const isHttps = url.protocol === "https:";
    const isLoopback = url.hostname === "localhost" || url.hostname === "127.0.0.1";
    const doRequest = isHttps ? httpsRequest : httpRequest;

    return new Promise<T>((resolve, reject) => {
      const req = doRequest(
        url,
        {
          method,
          headers: {
            accept: "application/json",
            "content-type": "application/json",
            ...(this.device
              ? { "x-device-id": this.device.deviceId, "x-device-secret": this.device.deviceSecret }
              : {}),
          },
          // Accept the broker's self-signed cert only on loopback (local dev).
          ...(isHttps && isLoopback ? { rejectUnauthorized: false } : {}),
        },
        (res) => {
          let raw = "";
          res.on("data", (c) => (raw += c));
          res.on("end", () => {
            const status = res.statusCode ?? 0;
            if (status < 200 || status >= 300) {
              const err = new Error(`Broker ${method} ${path} failed (${status}): ${raw}`);
              (err as Error & { status: number }).status = status;
              return reject(err);
            }
            try {
              resolve(raw ? (JSON.parse(raw) as T) : ({} as T));
            } catch (err) {
              reject(err);
            }
          });
        },
      );
      req.on("error", reject);
      if (body !== undefined) req.write(JSON.stringify(body));
      req.end();
    });
  }
}
