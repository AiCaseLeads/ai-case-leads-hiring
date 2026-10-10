import { canonicalJson, sha256 } from "./crypto";
import { AshbyArchiveClient } from "../archive/ashby";
import { requireId } from "../archive/security";
import type { ApplicationInput } from "./types";

export class RecoveryError extends Error {}
export class SubmissionRecovery {
  constructor(
    private db: D1Database,
    private provider: AshbyArchiveClient,
  ) {}

  async pending() {
    return (
      await this.db
        .prepare(
          "SELECT key_hash,job_posting_id,job_title,created_at,updated_at,error_code FROM hiring_submissions WHERE status = 'pending' ORDER BY created_at LIMIT 100",
        )
        .all()
    ).results;
  }

  async resolve(input: {
    keyHash: string;
    applicationId: string;
    submittedFormInstanceId: string;
    operatorId: string;
    evidenceId: string;
    confirmExactSubmission: boolean;
    originalPayload: Omit<ApplicationInput, "submissionKey">;
  }) {
    if (
      !/^[a-f0-9]{64}$/.test(input.keyHash) ||
      input.confirmExactSubmission !== true
    )
      throw new RecoveryError("operator_confirmation_required");
    for (const id of [
      input.applicationId,
      input.submittedFormInstanceId,
      input.operatorId,
      input.evidenceId,
    ])
      requireId(id);
    const payload = input.originalPayload;
    if (
      !payload ||
      !Array.isArray(payload.fieldSubmissions) ||
      !payload.fieldSubmissions.length ||
      payload.fieldSubmissions.some((f) => typeof f.path !== "string") ||
      new Set(payload.fieldSubmissions.map((f) => f.path)).size !==
        payload.fieldSubmissions.length
    )
      throw new RecoveryError("invalid_original_payload");
    const row = await this.db
      .prepare(
        "SELECT fingerprint,job_posting_id,status,created_at FROM hiring_submissions WHERE key_hash = ?",
      )
      .bind(input.keyHash)
      .first<{
        fingerprint: string;
        job_posting_id: string;
        status: string;
        created_at: number;
      }>();
    if (!row || row.status !== "pending")
      throw new RecoveryError("pending_submission_not_found");
    // Recompute the exact original browser payload. Names/emails are never used to guess a match.
    const fingerprint = await sha256(
      canonicalJson({
        jobPostingId: payload.jobPostingId,
        fieldSubmissions: [...payload.fieldSubmissions].sort((a, b) =>
          a.path.localeCompare(b.path),
        ),
        utmData: payload.utmData || null,
      }),
    );
    if (
      fingerprint !== row.fingerprint ||
      payload.jobPostingId !== row.job_posting_id
    )
      throw new RecoveryError("original_payload_mismatch");
    const application = await this.provider.application(input.applicationId);
    if (application.appliedViaJobPostingId !== row.job_posting_id)
      throw new RecoveryError("provider_posting_mismatch");
    const form = application.applicationFormSubmissions?.find(
      (f) => f.id === input.submittedFormInstanceId,
    );
    const values = form?.submittedValues;
    if (!values || typeof values !== "object" || Array.isArray(values))
      throw new RecoveryError("provider_form_unavailable");
    if (
      payload.fieldSubmissions.some(
        (f) =>
          !(f.path in values) ||
          canonicalJson((values as Record<string, unknown>)[f.path]) !==
            canonicalJson(f.value),
      )
    )
      throw new RecoveryError("provider_answers_mismatch");
    // Record immutable operator evidence with the state change in a single atomic update.
    const update = this.db
      .prepare(
        "UPDATE hiring_submissions SET status='accepted',application_id=?,submitted_form_instance_id=?,resolution_operator_id=?,resolution_evidence_id=?,updated_at=?,error_code=NULL WHERE key_hash=? AND status='pending' AND fingerprint=? AND NOT EXISTS (SELECT 1 FROM hiring_submissions WHERE submitted_form_instance_id=? AND key_hash<>?)",
      )
      .bind(
        input.applicationId,
        input.submittedFormInstanceId,
        input.operatorId,
        input.evidenceId,
        Date.now(),
        input.keyHash,
        fingerprint,
        input.submittedFormInstanceId,
        input.keyHash,
      );
    const eventId = `manual-resolution:${input.keyHash}`;
    const archive = this.db
      .prepare(
        "INSERT INTO archive_events (id,application_id,action,payload_hash,status,created_at,updated_at) SELECT ?,application_id,'manual-resolution',?,'pending',?,? FROM hiring_submissions WHERE key_hash=? AND status='accepted' AND resolution_operator_id=? AND resolution_evidence_id=? AND submitted_form_instance_id=? ON CONFLICT(id) DO NOTHING",
      )
      .bind(
        eventId,
        eventId,
        Date.now(),
        Date.now(),
        input.keyHash,
        input.operatorId,
        input.evidenceId,
        input.submittedFormInstanceId,
      );
    // D1 batch is transactional: acceptance and its durable archive outbox are committed together.
    const [result] = await this.db.batch([update, archive]);
    if (result.meta.changes !== 1)
      throw new RecoveryError("resolution_conflict");
    // A Drive failure is separate; the persisted outbox retries it without losing acceptance.
    return { status: "accepted", applicationId: input.applicationId };
  }
}
