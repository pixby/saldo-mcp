import type { Account, Balance, Institution, Transaction } from "../../domain/types.js";
import type { BankProvider, BeginLinkResult, CompletedLink } from "../provider.js";
import { EnableBankingClient, type EnableBankingClientOptions } from "./client.js";
import {
  mapAccountDetails,
  mapBalance,
  mapInstitution,
  mapTransaction,
  parseInstitutionId,
} from "./mappers.js";
import type {
  EBAccountDetails,
  EBAspspsResponse,
  EBAuthResponse,
  EBBalancesResponse,
  EBSessionResponse,
  EBTransactionsResponse,
} from "./types.js";

/** How long a consent/session is requested for (Enable Banking caps at ~180 days). */
const CONSENT_DAYS = 180;

export class EnableBankingProvider implements BankProvider {
  readonly id = "enablebanking";
  private readonly client: EnableBankingClient;

  constructor(options: EnableBankingClientOptions) {
    this.client = new EnableBankingClient(options);
  }

  async listInstitutions(country: string): Promise<Institution[]> {
    const data = await this.client.request<EBAspspsResponse>("GET", "/aspsps", {
      query: { country: country.toUpperCase() },
    });
    return (data.aspsps ?? []).map(mapInstitution);
  }

  async beginLink(params: {
    institutionId: string;
    redirectUrl: string;
    state: string;
  }): Promise<BeginLinkResult> {
    const { country, name } = parseInstitutionId(params.institutionId);
    const validUntil = new Date(Date.now() + CONSENT_DAYS * 86400_000).toISOString();
    const res = await this.client.request<EBAuthResponse>("POST", "/auth", {
      body: {
        access: { valid_until: validUntil, balances: true, transactions: true },
        aspsp: { name, country },
        redirect_url: params.redirectUrl,
        state: params.state,
        psu_type: "personal",
      },
    });
    return { url: res.url, referenceId: res.authorization_id };
  }

  async completeLink(code: string): Promise<CompletedLink> {
    const session = await this.client.request<EBSessionResponse>("POST", "/sessions", {
      body: { code },
    });
    return {
      sessionId: session.session_id,
      accountIds: (session.accounts ?? []).map((a) => a.uid),
      validUntil: session.access?.valid_until,
    };
  }

  async revokeSession(sessionId: string): Promise<void> {
    await this.client.request("DELETE", `/sessions/${sessionId}`);
  }

  async getAccount(accountId: string): Promise<Account> {
    const details = await this.client.request<EBAccountDetails>(
      "GET",
      `/accounts/${accountId}/details`,
    );
    return mapAccountDetails(accountId, details);
  }

  async getBalances(accountId: string): Promise<Balance[]> {
    const data = await this.client.request<EBBalancesResponse>(
      "GET",
      `/accounts/${accountId}/balances`,
    );
    return (data.balances ?? []).map((b) => mapBalance(accountId, b));
  }

  async getTransactions(accountId: string, from?: string, to?: string): Promise<Transaction[]> {
    const transactions: Transaction[] = [];
    let continuationKey: string | undefined;
    // Enable Banking paginates with a continuation_key; walk until it's gone.
    do {
      const data: EBTransactionsResponse = await this.client.request<EBTransactionsResponse>(
        "GET",
        `/accounts/${accountId}/transactions`,
        { query: { date_from: from, date_to: to, continuation_key: continuationKey } },
      );
      for (const t of data.transactions ?? []) transactions.push(mapTransaction(accountId, t));
      continuationKey = data.continuation_key;
    } while (continuationKey);
    return transactions;
  }
}
