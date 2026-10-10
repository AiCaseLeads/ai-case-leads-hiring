export type Fetch = typeof fetch;
export class ProviderError extends Error {
  constructor(public provider: string, public status: number, public code?: string) { super(`${provider}_${code || status}`); }
}
export function delay(ms: number): Promise<void> { return new Promise((resolve) => setTimeout(resolve, ms)); }
export async function providerRequest(url: string, init: RequestInit, provider: string, fetcher: Fetch = fetch, wait = delay, deadline?: () => number | undefined): Promise<Response> {
  const remaining = () => (deadline?.() ?? Infinity) - Date.now();
  const pause = async (ms: number) => {
    if (remaining() <= ms) throw new ProviderError(provider, 0, "deadline_exceeded");
    await wait(ms);
  };
  for (let attempt = 0; attempt < 5; attempt++) {
    if (remaining() <= 0) throw new ProviderError(provider, 0, "deadline_exceeded");
    let response: Response;
    try { response = await fetcher(url, { ...init, redirect: "manual", signal: AbortSignal.timeout(Math.max(1, Math.min(60_000, remaining()))) }); }
    catch { if (remaining() <= 0) throw new ProviderError(provider, 0, "deadline_exceeded"); if (attempt === 4) throw new ProviderError(provider, 0, "network_failure"); await pause(Math.min(1000 * 2 ** attempt, 10000)); continue; }
    if (response.status >= 300 && response.status < 400 && response.status !== 308) throw new ProviderError(provider, response.status, "redirect_rejected");
    if (response.status !== 429 && response.status < 500) return response;
    if (attempt === 4) throw new ProviderError(provider, response.status);
    const retry = response.headers.get("retry-after");
    const seconds = retry ? Number(retry) : NaN;
    const when = retry && !Number.isFinite(seconds) ? Date.parse(retry) - Date.now() : seconds * 1000;
    await pause(Number.isFinite(when) ? Math.max(0, Math.min(when, 60_000)) : Math.min(1000 * 2 ** attempt, 10000));
  }
  throw new ProviderError(provider, 0, "unreachable");
}
