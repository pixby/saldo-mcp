import { randomBytes } from "node:crypto";
import type { Institution } from "../domain/types.js";
import type { BankProvider } from "../providers/provider.js";
import type { StateStore } from "../state.js";
import { startCallbackServer } from "../util/callback-server.js";
import type { ConnectedSession, ConsentStrategy } from "./consent.js";

/**
 * Self-host consent: the connector runs the whole flow locally — a loopback
 * callback server captures the redirect code, the provider exchanges it for a
 * session, and linked accounts are persisted in the local state store.
 */
export class SelfHostConsent implements ConsentStrategy {
  constructor(
    private readonly provider: BankProvider,
    private readonly state: StateStore,
    private readonly redirectUrl: string,
  ) {}

  listInstitutions(country: string): Promise<Institution[]> {
    return this.provider.listInstitutions(country);
  }

  async link(
    institutionId: string,
    openUrl: (url: string) => void | Promise<void>,
  ): Promise<{ accountIds: string[] }> {
    const server = await startCallbackServer(this.redirectUrl);
    try {
      const state = randomBytes(16).toString("hex");
      const { url } = await this.provider.beginLink({
        institutionId,
        redirectUrl: server.redirectUrl,
        state,
      });
      await openUrl(url);
      const code = await server.waitForCode(state);
      const session = await this.provider.completeLink(code);
      await this.state.addSession({
        referenceId: session.sessionId,
        institutionId,
        createdAt: new Date().toISOString(),
        validUntil: session.validUntil,
        accountIds: session.accountIds,
      });
      return { accountIds: session.accountIds };
    } finally {
      await server.close();
    }
  }

  async accountIds(): Promise<string[]> {
    return this.state.accountIds;
  }

  async listSessions(): Promise<ConnectedSession[]> {
    return this.state.sessions.map((s) => ({
      sessionId: s.referenceId,
      institutionId: s.institutionId,
      validUntil: s.validUntil,
      accountIds: s.accountIds,
    }));
  }

  async disconnect(sessionId: string): Promise<void> {
    await this.state.removeSession(sessionId);
    // Best-effort: revoke at the provider too. Local removal already took effect.
    try {
      await this.provider.revokeSession(sessionId);
    } catch {
      /* consent may already be gone provider-side; local disconnect stands */
    }
  }
}
