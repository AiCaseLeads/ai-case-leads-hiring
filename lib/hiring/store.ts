import type { HiringStore, SubmissionRecord, UploadInput } from "./types";

type SubmissionRow = {
  key_hash: string; session_hash: string; fingerprint: string; job_posting_id: string; job_title: string;
  status: SubmissionRecord["status"]; receipt_hash: string | null; submitted_form_instance_id: string | null;
  application_id: string | null; created_at: number; updated_at: number;
};
function record(row: SubmissionRow | null): SubmissionRecord | null {
  return row ? { keyHash: row.key_hash, sessionHash: row.session_hash, fingerprint: row.fingerprint, jobPostingId: row.job_posting_id, jobTitle: row.job_title, status: row.status, receiptHash: row.receipt_hash, submittedFormInstanceId: row.submitted_form_instance_id, applicationId: row.application_id, createdAt: row.created_at, updatedAt: row.updated_at } : null;
}
export class D1HiringStore implements HiringStore {
  constructor(private db: D1Database) {}
  async claim(value: SubmissionRecord): Promise<boolean> {
    const result = await this.db.prepare("INSERT INTO hiring_submissions (key_hash,session_hash,fingerprint,job_posting_id,job_title,status,receipt_hash,submitted_form_instance_id,application_id,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(key_hash) DO NOTHING").bind(value.keyHash, value.sessionHash, value.fingerprint, value.jobPostingId, value.jobTitle, value.status, value.receiptHash, value.submittedFormInstanceId, value.applicationId, value.createdAt, value.updatedAt).run();
    return result.meta.changes === 1;
  }
  async find(keyHash: string) { return record(await this.db.prepare("SELECT * FROM hiring_submissions WHERE key_hash = ?").bind(keyHash).first<SubmissionRow>()); }
  async finish(keyHash: string, update: Partial<SubmissionRecord>, errorCode?: string): Promise<void> {
    const columns: [keyof SubmissionRecord, string][] = [["status", "status"], ["receiptHash", "receipt_hash"], ["submittedFormInstanceId", "submitted_form_instance_id"], ["applicationId", "application_id"], ["updatedAt", "updated_at"]];
    const supplied = columns.filter(([key]) => key in update);
    const assignments = supplied.map(([, col]) => `${col} = ?`);
    const values = supplied.map(([key]) => update[key] ?? null);
    if (errorCode !== undefined) { assignments.push("error_code = ?"); values.push(errorCode); }
    if (!assignments.length) return;
    const result = await this.db.prepare(`UPDATE hiring_submissions SET ${assignments.join(",")} WHERE key_hash = ?`).bind(...values, keyHash).run();
    if (result.meta.changes !== 1) throw new Error("Submission tracking update failed");
  }
  async receipt(receiptHash: string) {
    return record(await this.db.prepare("SELECT s.* FROM hiring_submissions s WHERE s.receipt_hash = ? OR s.key_hash IN (SELECT submission_key_hash FROM hiring_receipts WHERE receipt_hash = ?)").bind(receiptHash, receiptHash).first<SubmissionRow>());
  }
  async addReceipt(keyHash: string, receiptHash: string) {
    await this.db.prepare("INSERT INTO hiring_receipts (receipt_hash, submission_key_hash, created_at) VALUES (?,?,?)").bind(receiptHash, keyHash, Date.now()).run();
  }
  async rememberUpload(handleHash: string, sessionHash: string, input: UploadInput, expiresAt: number) {
    await this.db.prepare("INSERT INTO hiring_uploads (handle_hash,session_hash,job_posting_id,field_path,filename,content_type,content_length,expires_at) VALUES (?,?,?,?,?,?,?,?)").bind(handleHash, sessionHash, input.jobPostingId, input.fieldPath, input.filename, input.contentType, input.contentLength, expiresAt).run();
  }
  async ownsUpload(handleHash: string, sessionHash: string, jobPostingId: string, fieldPath: string, now: number): Promise<boolean> {
    const row = await this.db.prepare("SELECT handle_hash FROM hiring_uploads WHERE handle_hash = ? AND session_hash = ? AND job_posting_id = ? AND field_path = ? AND expires_at > ?").bind(handleHash, sessionHash, jobPostingId, fieldPath, now).first();
    return row !== null;
  }
  async takeRateLimit(keyHash: string, window: number, limit: number, intentHash?: string): Promise<boolean> {
    if (intentHash) {
      const intentKey = `rate-intent:${intentHash}`;
      // These run in one transaction: reserve an allowed intent, charge only a
      // new reservation, then report its outcome. Denied intents never receive
      // a marker, so a concurrent duplicate cannot bypass an exhausted budget.
      await this.db.batch([
        this.db.prepare("INSERT INTO hiring_rate_limits(key_hash,window,attempts) SELECT ?,?,1 WHERE NOT EXISTS(SELECT 1 FROM hiring_rate_limits WHERE key_hash=? AND window=? AND attempts>=?) ON CONFLICT(key_hash,window) DO NOTHING").bind(intentKey,window,keyHash,window,limit),
        this.db.prepare("INSERT INTO hiring_rate_limits(key_hash,window,attempts) SELECT ?,?,1 WHERE changes()=1 ON CONFLICT(key_hash,window) DO UPDATE SET attempts=hiring_rate_limits.attempts+1").bind(keyHash,window),
      ]);
      return !!await this.db.prepare("SELECT attempts FROM hiring_rate_limits WHERE key_hash=? AND window=?").bind(intentKey,window).first();
    }
    const result = await this.db.prepare("INSERT INTO hiring_rate_limits (key_hash,window,attempts) VALUES (?,?,1) ON CONFLICT(key_hash,window) DO UPDATE SET attempts = hiring_rate_limits.attempts + 1 WHERE hiring_rate_limits.attempts < ? RETURNING attempts").bind(keyHash, window, limit).first<{ attempts: number }>();
    return !!result && result.attempts <= limit;
  }
}
