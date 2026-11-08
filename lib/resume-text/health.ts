import { eligibleFileSql, RESUME_TEXT_MIMES, RESUME_TEXT_VERSION } from './cache';

// The HTTP server and scheduler are separate bundles in the same process.
const KEY = Symbol.for('ai-case-leads.railway.resume-text-health');
type Heartbeat = { lastStartedAt: number; lastFinishedAt: number | null; lastErrorAt: number | null; running: boolean };
const state = globalThis as typeof globalThis & { [KEY]?: Heartbeat };

export function startTextCycle() {
  state[KEY] = {
    lastStartedAt: Date.now(),
    lastFinishedAt: state[KEY]?.lastFinishedAt ?? null,
    lastErrorAt: state[KEY]?.lastErrorAt ?? null,
    running: true,
  };
}

export function finishTextCycle(failed: boolean) {
  const heartbeat = state[KEY];
  if (!heartbeat) return;
  heartbeat.running = false;
  heartbeat.lastFinishedAt = Date.now();
  if (failed) heartbeat.lastErrorAt = heartbeat.lastFinishedAt;
}

async function countFiles(db: D1Database) {
  // Only aggregate supported uploads. Reading the text column here would make
  // health probes increasingly expensive as the backfill progresses.
  const counts = await db.prepare(`SELECT COUNT(*) AS totalFiles,
    COUNT(CASE WHEN c.file_id IS NULL OR c.status='pending' THEN 1 END) AS pending,
    COUNT(CASE WHEN c.status='running' THEN 1 END) AS running,
    COUNT(CASE WHEN c.status='ready' AND c.truncated=0 AND c.ocr_incomplete=0 THEN 1 END) AS ready,
    COUNT(CASE WHEN c.status='ready' AND (c.truncated<>0 OR c.ocr_incomplete<>0) THEN 1 END) AS partial,
    COUNT(CASE WHEN c.status NOT IN ('pending','running','ready') THEN 1 END) AS failed
    FROM hub_files f LEFT JOIN hub_file_text c ON c.file_id=f.id AND c.uploaded_at=f.uploaded_at
      AND c.content_type=f.content_type AND c.size=f.size AND c.parser_version=?
    WHERE f.uploaded_at>0 AND f.content_type IN (${RESUME_TEXT_MIMES.map(()=>'?').join(',')}) AND ${eligibleFileSql()}`)
    .bind(RESUME_TEXT_VERSION, ...RESUME_TEXT_MIMES, Date.now()).first();
  return counts;
}

const snapshots = new WeakMap<D1Database, { at: number; counts: Awaited<ReturnType<typeof countFiles>> }>();

export async function resumeCoverage(db: D1Database) {
  const now = Date.now();
  let snapshot = snapshots.get(db);
  if (!snapshot || now - snapshot.at >= 15_000) {
    snapshot = { at: now, counts: await countFiles(db) };
    snapshots.set(db, snapshot);
  }
  return { ...snapshot.counts, worker: state[KEY] ? { ...state[KEY] } : null };
}
