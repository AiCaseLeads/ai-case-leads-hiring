import type { ArchiveEvent, ArchiveItem, Checkpoint, ItemState } from "./contracts";

export interface ArchiveDb {
  prepare(sql: string): {
    bind(...values: unknown[]): {
      first<T>(): Promise<T | null>;
      all<T>(): Promise<{ results: T[] }>;
      run(): Promise<unknown>;
    };
  };
}

export class ArchiveStore implements ItemState {
  constructor(private db: ArchiveDb) {}

  async enqueue(applicationId: string, eventId: string, action = "reconcile", hash = eventId): Promise<void> {
    await this.db.prepare(`INSERT INTO archive_events (id, application_id, action, payload_hash, status, created_at, updated_at)
      VALUES (?, ?, ?, ?, 'pending', ?, ?) ON CONFLICT(id) DO NOTHING`).bind(eventId, applicationId, action, hash, Date.now(), Date.now()).run();
  }

  async recordWebhook(eventId: string, applicationId: string | null, action: string, hash: string): Promise<"stored" | "duplicate" | "conflict"> {
    const existing = await this.db.prepare("SELECT payload_hash FROM archive_events WHERE id = ?").bind(eventId).first<{ payload_hash: string }>();
    if (existing) return existing.payload_hash === hash ? "duplicate" : "conflict";
    await this.db.prepare(`INSERT INTO archive_events (id, application_id, action, payload_hash, status, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?) ON CONFLICT(id) DO NOTHING`).bind(eventId, applicationId, action, hash, applicationId ? "pending" : "ignored", Date.now(), Date.now()).run();
    // A concurrent delivery may have inserted the ID after the first read.
    const inserted = await this.db.prepare("SELECT payload_hash FROM archive_events WHERE id = ?").bind(eventId).first<{ payload_hash: string }>();
    return inserted?.payload_hash === hash ? "stored" : "conflict";
  }

  async getEvent(id: string): Promise<ArchiveEvent | null> {
    return this.db.prepare("SELECT * FROM archive_events WHERE id = ?").bind(id).first<ArchiveEvent>();
  }

  async pending(limit = 100): Promise<ArchiveEvent[]> {
    const { results } = await this.db.prepare(`SELECT * FROM archive_events WHERE application_id IS NOT NULL
      AND (status = 'pending' OR (status = 'error' AND COALESCE(next_attempt_at, 0) <= ?) OR (status = 'running' AND lease_until < ?))
      ORDER BY CASE WHEN status = 'error' THEN 1 ELSE 0 END, COALESCE(next_attempt_at, created_at), updated_at LIMIT ?`)
      .bind(Date.now(), Date.now(), Math.max(1, Math.min(limit, 100))).all<ArchiveEvent>();
    return results;
  }

  async claim(id: string): Promise<ArchiveEvent | null> {
    const now = Date.now();
    const token = crypto.randomUUID();
    await this.db.prepare(`UPDATE archive_events SET status = 'running', lease_token = ?, lease_until = ?, attempts = attempts + 1, updated_at = ?
      WHERE id = ? AND application_id IS NOT NULL AND (status = 'pending' OR (status = 'error' AND COALESCE(next_attempt_at, 0) <= ?) OR (status = 'running' AND lease_until < ?))`)
      .bind(token, now + 30 * 60 * 1000, now, id, now, now).run();
    const event = await this.getEvent(id);
    return event?.lease_token === token ? event : null;
  }

  async complete(id: string, token: string, status: "synced" | "error", folderId: string | null, error: string | null): Promise<void> {
    const event = await this.getEvent(id);
    if (!event || event.lease_token !== token) return;
    const nextAttempt = status === "error" ? Date.now() + Math.min(6 * 60 * 60 * 1000, 5000 * 2 ** Math.min(20, Math.max(0, event.attempts - 1))) : null;
    await this.db.prepare(`UPDATE archive_events SET status = ?, folder_id = COALESCE(?, folder_id), last_error = ?, lease_token = NULL, lease_until = NULL, next_attempt_at = ?, updated_at = ?
      WHERE id = ? AND lease_token = ?`).bind(status, folderId, error, nextAttempt, Date.now(), id, token).run();
  }

  async get(key: string): Promise<ArchiveItem | null> {
    return this.db.prepare("SELECT * FROM archive_items WHERE key = ?").bind(key).first<ArchiveItem>();
  }

  async reserve(key: string, driveId: string, parentId: string): Promise<ArchiveItem> {
    await this.db.prepare(`INSERT INTO archive_items (key, drive_id, parent_id, updated_at) VALUES (?, ?, ?, ?)
      ON CONFLICT(key) DO NOTHING`).bind(key, driveId, parentId, Date.now()).run();
    const item = await this.get(key);
    if (!item || item.parent_id !== parentId) throw new Error("archive_parent_mismatch");
    return item;
  }

  async update(key: string, contentHash: string | null, sessionUrl: string | null): Promise<void> {
    await this.db.prepare("UPDATE archive_items SET content_hash = ?, session_url = ?, updated_at = ? WHERE key = ?")
      .bind(contentHash, sessionUrl, Date.now(), key).run();
  }

  async checkpoint(stream: string): Promise<Checkpoint> {
    await this.db.prepare("INSERT INTO archive_checkpoints (stream, updated_at) VALUES (?, ?) ON CONFLICT(stream) DO NOTHING").bind(stream, Date.now()).run();
    const row = await this.db.prepare("SELECT * FROM archive_checkpoints WHERE stream = ?").bind(stream).first<Checkpoint>();
    if (!row) throw new Error("checkpoint_unavailable");
    return row;
  }

  async advance(stream: string, revision: number, cursor: string | null, syncToken: string | null, error: string | null = null): Promise<Checkpoint> {
    await this.db.prepare(`UPDATE archive_checkpoints SET cursor = ?, sync_token = ?, last_error = ?, revision = revision + 1, updated_at = ? WHERE stream = ? AND revision = ?`)
      .bind(cursor, syncToken, error, Date.now(), stream, revision).run();
    const row = await this.checkpoint(stream);
    if (row.revision !== revision + 1) throw new Error("checkpoint_conflict");
    return row;
  }

  async unresolved(): Promise<Array<{ key_hash: string; submitted_form_instance_id: string }>> {
    return (await this.db.prepare(`SELECT key_hash, submitted_form_instance_id FROM hiring_submissions
      WHERE status = 'accepted' AND application_id IS NULL AND submitted_form_instance_id IS NOT NULL LIMIT 100`)
      .bind().all<{ key_hash: string; submitted_form_instance_id: string }>()).results;
  }

  async resolveSubmission(keyHash: string, applicationId: string): Promise<void> {
    await this.db.prepare(`UPDATE hiring_submissions SET application_id = ?, error_code = NULL, updated_at = ?
      WHERE key_hash = ? AND status = 'accepted' AND application_id IS NULL`).bind(applicationId, Date.now(), keyHash).run();
    const row = await this.db.prepare("SELECT application_id FROM hiring_submissions WHERE key_hash = ? AND status = 'accepted'").bind(keyHash).first<{ application_id: string | null }>();
    if (row?.application_id !== applicationId) throw new Error("submission_identity_mismatch");
    await this.enqueue(applicationId, `submission:${keyHash}`, "websiteSubmission");
  }

  async resolutionError(keyHash: string, error: string): Promise<void> {
    await this.db.prepare(`UPDATE hiring_submissions SET error_code = ?, updated_at = ?
      WHERE key_hash = ? AND status = 'accepted' AND application_id IS NULL`).bind(error, Date.now(), keyHash).run();
  }

  async cleanupEphemeral(): Promise<void> {
    await this.db.prepare("DELETE FROM hiring_uploads WHERE expires_at < ?").bind(Date.now()).run();
    await this.db.prepare('DELETE FROM hiring_rate_limits WHERE "window" < ?').bind(Math.floor(Date.now() / 600000) - 144).run();
  }

  async status() {
    const counts = await this.db.prepare("SELECT status, count(*) AS count FROM archive_events GROUP BY status").bind().all<{ status: string; count: number }>();
    const errors = await this.db.prepare("SELECT * FROM archive_events WHERE status = 'error' ORDER BY updated_at DESC LIMIT 100").bind().all<ArchiveEvent>();
    const checkpoints = await this.db.prepare("SELECT * FROM archive_checkpoints ORDER BY stream").bind().all<Checkpoint>();
    const submissionAttention = await this.db.prepare(`SELECT status, count(*) AS count FROM hiring_submissions
      WHERE status IN ('pending', 'uncertain', 'submitting') OR (status = 'accepted' AND application_id IS NULL) GROUP BY status`).bind().all<{ status: string; count: number }>();
    const unresolvedErrors = await this.db.prepare(`SELECT key_hash, error_code, updated_at FROM hiring_submissions
      WHERE status = 'accepted' AND application_id IS NULL AND error_code IS NOT NULL ORDER BY updated_at DESC LIMIT 100`).bind().all<{ key_hash: string; error_code: string; updated_at: number }>();
    return { counts: counts.results, errors: errors.results, checkpoints: checkpoints.results, submissionAttention: submissionAttention.results, unresolvedErrors: unresolvedErrors.results };
  }
}

export async function enqueueArchive(db: ArchiveDb, applicationId: string, eventId: string): Promise<void> {
  await new ArchiveStore(db).enqueue(applicationId, eventId, "websiteSubmission");
}
