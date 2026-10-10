export interface BackgroundHealth { startedAt: number; lastCycleAt: number | null; enabled: boolean; running: boolean; stopping: boolean; error: string | null }
const KEY = Symbol.for("ai-case-leads.railway.background");
const globalState = globalThis as typeof globalThis & { [KEY]?: BackgroundHealth };
export function backgroundHealth(): BackgroundHealth | null { return globalState[KEY] ? { ...globalState[KEY] } : null; }
export interface BackgroundOptions { enabled?: boolean; intervalMs?: number; drainMs?: number; log?: (code: string) => void }
/** A single awaited loop, so timers can never overlap processing cycles. */
export class BackgroundRunner {
  private timer?: ReturnType<typeof setTimeout>;
  private pending?: Promise<void>;
  private state: BackgroundHealth;
  private interval: number;
  private drain: number;
  constructor(private cycle: () => Promise<void>, private options: BackgroundOptions = {}) {
    this.interval = options.intervalMs ?? 60_000;
    this.drain = options.drainMs ?? 45_000;
    this.state = { startedAt: Date.now(), lastCycleAt: null, enabled: options.enabled !== false, running: false, stopping: false, error: null };
  }
  async start(): Promise<void> {
    if (globalState[KEY] && !globalState[KEY]!.stopping) throw new Error("background_runner_already_started");
    globalState[KEY] = this.state;
    if (this.state.enabled) await this.run();
  }
  private async run(): Promise<void> {
    if (this.state.stopping || this.pending) return;
    this.state.running = true;
    this.pending = (async () => {
      try { await this.cycle(); this.state.error = null; }
      catch { this.state.error = "background_cycle_failed"; this.options.log?.("background_cycle_failed"); }
      finally { this.state.lastCycleAt = Date.now(); this.state.running = false; }
    })();
    await this.pending;
    this.pending = undefined;
    if (!this.state.stopping) this.timer = setTimeout(() => { void this.run(); }, this.interval);
  }
  async stop(): Promise<boolean> {
    this.state.stopping = true;
    if (this.timer) clearTimeout(this.timer);
    if (!this.pending) return true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const drained = await Promise.race([this.pending.then(() => true), new Promise<boolean>(resolve => { timer = setTimeout(() => resolve(false), this.drain); })]);
    if (timer) clearTimeout(timer);
    return drained;
  }
}
