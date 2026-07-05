import type { TokenProvider } from "./token.js";

/**
 * Thin HTTP client for the Enable Banking API.
 * Docs: https://enablebanking.com/docs/api/reference/
 *
 * The bearer token comes from a TokenProvider (local key sign, or broker mint),
 * so the same client serves self-host and managed mode. On a 401 we force a
 * token refresh and retry once.
 */

const DEFAULT_BASE_URL = "https://api.enablebanking.com";

export interface EnableBankingClientOptions {
  getToken: TokenProvider;
  baseUrl?: string;
}

export class EnableBankingError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly body: unknown,
  ) {
    super(message);
    this.name = "EnableBankingError";
  }
}

export class EnableBankingClient {
  private readonly baseUrl: string;

  constructor(private readonly options: EnableBankingClientOptions) {
    this.baseUrl = options.baseUrl ?? DEFAULT_BASE_URL;
  }

  async request<T>(
    method: string,
    path: string,
    init: { query?: Record<string, string | undefined>; body?: unknown } = {},
  ): Promise<T> {
    const url = new URL(`${this.baseUrl}${path}`);
    for (const [key, value] of Object.entries(init.query ?? {})) {
      if (value !== undefined) url.searchParams.set(key, value);
    }

    const send = (jwt: string) =>
      fetch(url, {
        method,
        headers: {
          accept: "application/json",
          "content-type": "application/json",
          authorization: `Bearer ${jwt}`,
        },
        body: init.body === undefined ? undefined : JSON.stringify(init.body),
      });

    let res = await send(await this.options.getToken());
    if (res.status === 401) res = await send(await this.options.getToken(true));

    if (!res.ok) {
      const body = await res.json().catch(() => undefined);
      throw new EnableBankingError(
        `Enable Banking request failed: ${method} ${path} (${res.status})`,
        res.status,
        body,
      );
    }
    return (await res.json()) as T;
  }
}
