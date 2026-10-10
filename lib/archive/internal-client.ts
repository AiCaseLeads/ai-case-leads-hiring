import type { ArchiveEvent, ArchiveItem, Checkpoint, ItemState } from "./contracts";
import { providerRequest, ProviderError, type Fetch } from "./http";

export class ArchiveInternalClient implements ItemState {
  private origin: string;
  constructor(siteUrl: string, private secret: string, private fetcher: Fetch = fetch) {
    const url = new URL(siteUrl);
    if (url.protocol !== "https:" || url.username || url.password || url.port || secret.length < 32) throw new Error("internal_api_not_configured");
    this.origin = url.origin;
  }

  async call<T>(operation: string, body?: unknown, query?: Record<string, string>): Promise<T> {
    const search = query ? `?${new URLSearchParams(query)}` : "";
    const response = await providerRequest(`${this.origin}/api/internal/archive/${operation}${search}`, {
      method: body === undefined ? "GET" : "POST", headers: { Authorization: `Bearer ${this.secret}`, "Content-Type": "application/json" }, ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    }, "archive_internal", this.fetcher);
    if (!response.ok) throw new ProviderError("archive_internal", response.status);
    return response.json() as Promise<T>;
  }

  get(key: string): Promise<ArchiveItem | null> { return this.call("item", undefined, { key }); }
  reserve(key: string, driveId: string, parentId: string): Promise<ArchiveItem> { return this.call("item", { action: "reserve", key, driveId, parentId }); }
  async update(key: string, contentHash: string | null, sessionUrl: string | null): Promise<void> { await this.call("item", { action: "update", key, contentHash, sessionUrl }); }
  async pending(): Promise<ArchiveEvent[]> { return (await this.call<{ events: ArchiveEvent[] }>("outbox")).events; }
  async claim(eventId: string): Promise<ArchiveEvent | null> { return (await this.call<{ event: ArchiveEvent | null }>("claim", { eventId })).event; }
  async complete(eventId: string, leaseToken: string, status: "synced" | "error", folderId: string | null, error: string | null): Promise<void> { await this.call("complete", { eventId, leaseToken, status, folderId, error }); }
  checkpoint(stream: string): Promise<Checkpoint> { return this.call("checkpoint", undefined, { stream }); }
  async advance(checkpoint: Checkpoint, cursor: string | null, syncToken: string | null, error: string | null = null): Promise<Checkpoint> { return this.call("checkpoint", { stream: checkpoint.stream, revision: checkpoint.revision, cursor, syncToken, error }); }
  async enqueue(events: Array<{ applicationId: string; eventId: string; action: string }>): Promise<void> { await this.call("enqueue", { events }); }
}
