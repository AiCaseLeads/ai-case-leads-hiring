import type { AshbyArchiveClient } from "./ashby";
import type { ArchiveInternalClient } from "./internal-client";
import type { AshbyApplication, AshbyCandidate, AshbyTakeHome, Page } from "./contracts";
import { ProviderError } from "./http";
import { requireId, safeError, sha256 } from "./security";

const STREAMS = {
  applications: "application.list",
  candidates: "candidate.list",
  takehomes: "takeHomeAssignment.list",
} as const;
const RESET_CODES = new Set(["sync_token_expired", "sync_token_invalid", "incremental_sync_too_large", "next_cursor_expired", "cursor_invalid", "invalid_next_cursor"]);

export async function reconcilePage(ashby: AshbyArchiveClient, internal: Pick<ArchiveInternalClient, "checkpoint" | "advance" | "enqueue">, stream: keyof typeof STREAMS): Promise<{ more: boolean; enqueued: number }> {
  const checkpoint = await internal.checkpoint(stream);
  try {
    const data = await ashby.request<Page<AshbyApplication | AshbyCandidate | AshbyTakeHome>>(STREAMS[stream], {
      limit: 100,
      ...(checkpoint.cursor ? { cursor: checkpoint.cursor } : {}),
      ...(checkpoint.sync_token ? { syncToken: checkpoint.sync_token } : {}),
    });
    if (!Array.isArray(data.results) || typeof data.moreDataAvailable !== "boolean") throw new Error("invalid_ashby_page");
    if (data.moreDataAvailable && (!data.nextCursor || data.nextCursor === checkpoint.cursor)) throw new Error("ashby_pagination_stalled");
    const events: Array<{ applicationId: string; eventId: string; action: string }> = [];
    for (const row of data.results) {
      requireId(row.id);
      const applicationIds = stream === "applications" ? [row.id] : stream === "takehomes" ? [(row as AshbyTakeHome).applicationId] : (row as AshbyCandidate).applicationIds ?? [];
      const version = await sha256(JSON.stringify(row));
      for (const id of applicationIds) events.push({ applicationId: requireId(id), eventId: `reconcile:${stream}:${row.id}:${version}:${id}`, action: `reconcile_${stream}` });
    }
    // A candidate can have many applications. Enqueue bounded batches before checkpointing; replays deduplicate by provider ID and authoritative content.
    for (let offset = 0; offset < events.length; offset += 100) await internal.enqueue(events.slice(offset, offset + 100));
    await internal.advance(checkpoint, data.moreDataAvailable ? data.nextCursor! : null, data.moreDataAvailable ? checkpoint.sync_token : data.syncToken ?? null);
    return { more: data.moreDataAvailable, enqueued: events.length };
  } catch (error) {
    if (error instanceof ProviderError && error.code && RESET_CODES.has(error.code)) {
      // Never keep a cursor while dropping a syncToken: that would skip earlier records.
      await internal.advance(checkpoint, null, null, safeError(error));
      return { more: true, enqueued: 0 };
    }
    await internal.advance(checkpoint, checkpoint.cursor, checkpoint.sync_token, safeError(error));
    throw error;
  }
}

export const reconciliationStreams = Object.keys(STREAMS) as Array<keyof typeof STREAMS>;
