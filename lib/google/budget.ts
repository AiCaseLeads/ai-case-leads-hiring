import { GoogleError } from "./http";

/** One invocation budget, shared by token refresh and every provider request. */
export class GoogleBudget {
  deadline?: number;
  check(): void {
    if (this.deadline !== undefined && Date.now() >= this.deadline)
      throw new GoogleError("processor_deadline_exceeded");
  }
  fetch(fetcher: typeof fetch): typeof fetch {
    return async (input, init = {}) => {
      this.check();
      if (this.deadline === undefined) return fetcher(input, init);
      const remaining = Math.max(1, this.deadline - Date.now());
      const signal = AbortSignal.timeout(remaining);
      return fetcher(input, { ...init, signal: init.signal ? AbortSignal.any([signal, init.signal]) : signal });
    };
  }
}
