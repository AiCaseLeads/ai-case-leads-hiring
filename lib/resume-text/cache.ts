import type { HubStore } from '../hub/store';

export const RESUME_TEXT_VERSION = 'resume_text_v1';
export const MAX_RESUME_TEXT_CHARS = 200000;
export const RESUME_TEXT_MIMES = ['application/pdf', 'application/msword', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'text/plain'] as const;
export const RESUME_TEXT_LEASE_MS = 120000;
export const RESUME_TEXT_MAX_ATTEMPTS = 5;
export type CacheFileIdentity = { id: string; uploaded_at: number; size: number; content_type: string };
export type FileTextStatus = 'pending' | 'running' | 'ready' | 'failed' | 'no_text' | 'password_protected' | 'invalid' | 'too_many_pages' | 'too_large';
export type CachedFileText = {
  status: FileTextStatus; text: string; truncated: boolean; ocrIncomplete: boolean; complete: boolean;
  errorCode: string | null; retryAfterSeconds: number | null; parserVersion: string; pages: number; ocrPages: number;
};
export type FileTextRow = {
  file_id: string; uploaded_at: number; size: number; content_type: string; parser_version: string; status: FileTextStatus;
  text: string; truncated: number; ocr_incomplete: number; pages: number; ocr_pages: number; error_code: string | null;
  attempts: number; run_after: number; lease_token: string | null; lease_until: number; created_at: number; updated_at: number;
};
export const eligibleFileSql = (alias = 'f') => `(${alias}.application_id IS NULL AND ${alias}.expires_at>? OR ${alias}.application_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM hub_settings trash WHERE trash.key='application_trash:'||${alias}.application_id))`;
const supportedSql = RESUME_TEXT_MIMES.map(() => '?').join(',');

function pending(): CachedFileText {
  return { status: 'pending', text: '', truncated: false, ocrIncomplete: false, complete: false, errorCode: null, retryAfterSeconds: 5, parserVersion: RESUME_TEXT_VERSION, pages: 0, ocrPages: 0 };
}
/** Cache-only lookup. No bucket access, parsing, queue writes or applicant mutations. */
export async function readCachedFileTexts(store: HubStore, files: CacheFileIdentity[], now = Date.now()): Promise<Map<string, CachedFileText>> {
  const result = new Map(files.map(file => [file.id, RESUME_TEXT_MIMES.includes(file.content_type as typeof RESUME_TEXT_MIMES[number]) ? pending() : {...pending(),status:'failed' as const,errorCode:'text_unsupported',retryAfterSeconds:null}]));
  for (let offset = 0; offset < files.length; offset += 50) {
    const chunk = files.slice(offset, offset + 50);
    const rows = await store.rows<FileTextRow>(`SELECT c.* FROM hub_file_text c JOIN hub_files f ON f.id=c.file_id AND f.uploaded_at=c.uploaded_at AND f.size=c.size AND f.content_type=c.content_type WHERE c.file_id IN (${chunk.map(() => '?').join(',')}) AND c.parser_version=? AND f.uploaded_at>0 AND ${eligibleFileSql()}`, ...chunk.map(file => file.id), RESUME_TEXT_VERSION, now);
    for (const row of rows) {
      const identity = chunk.find(file => file.id === row.file_id);
      if (!identity || !RESUME_TEXT_MIMES.includes(identity.content_type as typeof RESUME_TEXT_MIMES[number]) || identity.uploaded_at !== row.uploaded_at || identity.size !== row.size || identity.content_type !== row.content_type) continue;
      const waiting = row.status === 'pending' || row.status === 'running';
      const text = row.status === 'ready' ? row.text : '';
      result.set(row.file_id, { status: row.status, text, truncated: !!row.truncated, ocrIncomplete: !!row.ocr_incomplete, complete: row.status === 'ready' && !row.truncated && !row.ocr_incomplete, errorCode: row.error_code, retryAfterSeconds: waiting ? Math.max(5, Math.ceil(((row.status === 'running' ? Math.min(row.lease_until,now+5000) : row.run_after) - now) / 1000)) : null, parserVersion: row.parser_version, pages: row.pages, ocrPages: row.ocr_pages });
    }
  }
  return result;
}

/** Called after successful upload; the parser never runs on the HTTP submission path. */
export async function queueFileText(db: D1Database, fileId: string, now = Date.now()): Promise<void> {
  await db.prepare(`INSERT INTO hub_file_text(file_id,uploaded_at,size,content_type,parser_version,status,created_at,updated_at) SELECT f.id,f.uploaded_at,f.size,f.content_type,?,'pending',?,? FROM hub_files f WHERE f.id=? AND f.uploaded_at>0 AND f.content_type IN (${supportedSql}) AND ${eligibleFileSql()} ON CONFLICT(file_id) DO UPDATE SET uploaded_at=excluded.uploaded_at,size=excluded.size,content_type=excluded.content_type,parser_version=excluded.parser_version,status='pending',text='',truncated=0,ocr_incomplete=0,pages=0,ocr_pages=0,error_code=NULL,attempts=0,run_after=0,lease_token=NULL,lease_until=0,updated_at=excluded.updated_at WHERE hub_file_text.uploaded_at<>excluded.uploaded_at OR hub_file_text.size<>excluded.size OR hub_file_text.content_type<>excluded.content_type OR hub_file_text.parser_version<>excluded.parser_version`).bind(RESUME_TEXT_VERSION, now, now, fileId, ...RESUME_TEXT_MIMES, now).run();
}

/** Bounded repair/backfill discovery; existing identity-matched rows are untouched. */
export async function discoverFileText(store: HubStore, now = Date.now(), limit = 100): Promise<number> {
  const files = await store.rows<{id:string}>(`SELECT f.id FROM hub_files f LEFT JOIN hub_file_text c ON c.file_id=f.id WHERE f.uploaded_at>0 AND f.content_type IN (${supportedSql}) AND ${eligibleFileSql()} AND (c.file_id IS NULL OR c.uploaded_at<>f.uploaded_at OR c.size<>f.size OR c.content_type<>f.content_type OR c.parser_version<>?) ORDER BY (f.application_id IS NOT NULL) DESC,f.uploaded_at DESC,f.id LIMIT ?`, ...RESUME_TEXT_MIMES, now, RESUME_TEXT_VERSION, Math.max(1, Math.min(limit, 100)));
  for (const file of files) await queueFileText(store.db, file.id, now);
  return files.length;
}

export const RESUME_BACKGROUND_CONCURRENCY = 2;
export const RESUME_BATCH_SIZE = 10;

/** A single SQLite write both chooses the file and reserves parser capacity.
 * The interactive slot remains available while two background files are running.
 * Each file's own lease fences replacements, expired workers and duplicate reads. */
export async function claimFileText(store: HubStore, now = Date.now(), target?: CacheFileIdentity): Promise<FileTextRow | null> {
  const targetFilter = target ? 'AND c.file_id=? AND c.uploaded_at=? AND c.size=? AND c.content_type=?' : '';
  const targetArgs = target ? [target.id, target.uploaded_at, target.size, target.content_type] : [];
  const token = (target ? 'interactive:' : 'background:') + crypto.randomUUID();
  // A foreground request may only change its own authorized file, even on recovery.
  await store.stmt(`UPDATE hub_file_text SET status='failed',error_code='text_retry_exhausted',
    lease_token=NULL,lease_until=0,updated_at=?
    WHERE status='running' AND lease_until<=? AND attempts>=?
    ${target ? 'AND file_id=? AND uploaded_at=? AND size=? AND content_type=?' : ''}`,
    now, now, RESUME_TEXT_MAX_ATTEMPTS, ...targetArgs).run();
  return store.stmt(`UPDATE hub_file_text SET status='running',attempts=attempts+1,lease_token=?,lease_until=?,updated_at=?
    WHERE file_id=(SELECT c.file_id FROM hub_file_text c JOIN hub_files f
      ON f.id=c.file_id AND f.uploaded_at=c.uploaded_at AND f.size=c.size AND f.content_type=c.content_type
      WHERE c.parser_version=? AND c.attempts<? AND ((c.status='pending' AND c.run_after<=?) OR (c.status='running' AND c.lease_until<=?))
      AND ${eligibleFileSql()} ${targetFilter}
      AND (SELECT COUNT(*) FROM hub_file_text active WHERE active.status='running' AND active.lease_until>?
        AND ${target ? "active.lease_token LIKE 'interactive:%'" : "active.lease_token NOT LIKE 'interactive:%'"}) < ?
      ORDER BY (f.application_id IS NOT NULL) DESC,c.uploaded_at DESC,c.file_id LIMIT 1) RETURNING *`,
    token, now + RESUME_TEXT_LEASE_MS, now, RESUME_TEXT_VERSION, RESUME_TEXT_MAX_ATTEMPTS,
    now, now, now, ...targetArgs, now, target ? 1 : RESUME_BACKGROUND_CONCURRENCY).first<FileTextRow>();
}

/** Explicit operator-only recovery after an outage/restore, never called by reads
 * or the automatic worker. Reset only bounded retryable failures, not bad files. */
export async function requeueFailedFileText(store:HubStore,limit=1,now=Date.now()):Promise<number>{
  if(!Number.isSafeInteger(limit)||limit<1||limit>30)throw new Error('resume_requeue_limit_1_to_30');
  const codes=['pdf_timeout','pdf_unavailable','text_storage_timeout','text_file_unavailable','text_file_incomplete','text_extraction_failed','text_retry_exhausted','word_preview_timeout','word_preview_unavailable'];
  const result=await store.stmt(`UPDATE hub_file_text SET status='pending',text='',truncated=0,ocr_incomplete=0,pages=0,ocr_pages=0,error_code=NULL,attempts=0,run_after=0,lease_token=NULL,lease_until=0,updated_at=? WHERE file_id IN (SELECT c.file_id FROM hub_file_text c JOIN hub_files f ON f.id=c.file_id AND f.uploaded_at=c.uploaded_at AND f.size=c.size AND f.content_type=c.content_type WHERE c.status='failed' AND c.parser_version=? AND c.content_type IN (${supportedSql}) AND c.error_code IN (${codes.map(()=>'?').join(',')}) AND ${eligibleFileSql()} ORDER BY (f.application_id IS NOT NULL) DESC,c.uploaded_at DESC,c.file_id LIMIT ?)`,now,RESUME_TEXT_VERSION,...RESUME_TEXT_MIMES,...codes,now,limit).run();
  return Number(result.meta.changes??0);
}
