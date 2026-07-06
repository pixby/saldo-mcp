import { setTimeout as sleep } from "node:timers/promises";
import type { Institution } from "../domain/types.js";
import type { BrokerClient } from "../broker-client.js";
import type { ConnectedSession, ConsentStrategy } from "./consent.js";

/**
 * Managed consent: the broker runs the flow and holds the sessions. The app
 * starts consent via the broker, opens the returned URL (the bank redirects to
 * the *broker's* callback), then polls the broker until the new accounts appear.
 * The app never captures a code or holds the EB key.
 */
export class ManagedConsent implements ConsentStrategy {
  constructor(private readonly broker: BrokerClient) {}

  listInstitutions(country: string): Promise<Institution[]> {
    return this.broker.listInstitutions(country);
  }

  async link(
    institutionId: string,
    openUrl: (url: string) => void | Promise<void>,
  ): Promise<{ accountIds: string[] }> {
    const before = new Set(await this.accountIds());
    const { authUrl } = await this.broker.authStart(institutionId);
    await openUrl(authUrl);

    // Poll the broker until it reports new accounts from the completed consent.
    for (let attempt = 0; attempt < 60; attempt++) {
      await sleep(5000);
      const ids = await this.accountIds();
      const fresh = ids.filter((id) => !before.has(id));
      if (fresh.length) return { accountIds: fresh };
    }
    throw new Error("Timed out waiting for the bank connection to complete.");
  }

  async accountIds(): Promise<string[]> {
    const { accounts } = await this.broker.listAccounts();
    return accounts.map((a) => a.uid);
  }

  listSessions(): Promise<ConnectedSession[]> {
    return this.broker.listSessions();
  }

  disconnect(sessionId: string): Promise<void> {
    return this.broker.disconnect(sessionId);
  }

  entitlement() {
    return this.broker.entitlement();
  }

  createCheckout(plan: "individual" | "business") {
    return this.broker.createCheckout(plan);
  }
}

