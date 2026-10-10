import { googleFetch, GoogleError } from "./http";
import { refreshAccessToken, type OAuthClient } from "./oauth";
import { GoogleBudget } from "./budget";

export class GoogleClient {
  readonly budget = new GoogleBudget();
  private accessToken = "";
  private expiresAt = 0;
  private refreshing?: Promise<string>;
  constructor(private config: OAuthClient & { refreshToken: string }, private fetcher: typeof fetch) {
    if (!config.clientId || !config.clientSecret || !config.refreshToken) throw new GoogleError("google_not_connected");
  }
  private async token(force = false): Promise<string> {
    if (!force && this.accessToken && Date.now() < this.expiresAt) return this.accessToken;
    if (this.refreshing) return this.refreshing;
    this.refreshing = (async () => {
      this.budget.check();
      const tokens = await refreshAccessToken(this.config, this.budget.fetch(this.fetcher));
      this.accessToken = tokens.accessToken;
      this.expiresAt = Date.now() + Math.max(0, tokens.expiresIn - 60) * 1000;
      return this.accessToken;
    })();
    try { return await this.refreshing; } finally { this.refreshing = undefined; }
  }
  async request(url: string, init: RequestInit = {}, ambiguousWrite = false): Promise<Response> {
    this.budget.check();
    const make = async (force: boolean) => googleFetch(url, { ...init, headers: { ...Object.fromEntries(new Headers(init.headers)), Authorization: `Bearer ${await this.token(force)}` } }, this.budget.fetch(this.fetcher), ambiguousWrite);
    let response = await make(false);
    // A 401 is a definite rejection. Refresh once; network/5xx writes are never retried here.
    if (response.status === 401) response = await make(true);
    if (!response.ok) throw new GoogleError("google_permission_or_auth_required", response.status);
    return response;
  }
}
