import { canonicalJson, privateToken, sha256 } from "./crypto";
import { configurationError, HiringError, UncertainSubmissionError } from "./errors";
import type { ApplicationInput, HiringProvider, HiringStore, UploadInput } from "./types";
import { validateAnswers } from "./validation";

export type SubmissionResult = { status: "accepted" | "blocked" | "pending"; receipt?: string; message?: string };
export class HiringService {
  constructor(private provider: HiringProvider, private store: HiringStore, private enabled: boolean, private archive?: (applicationId: string, dedupeKey: string) => Promise<void>) {}
  private ensureEnabled() { if (!this.enabled) throw configurationError(); }
  private async publishedDefinition(jobPostingId: string) {
    // info alone could expose an unlisted or draft posting; verify both catalog and current detail.
    const jobs = await this.provider.listJobs();
    if (!jobs.some(job => job.id === jobPostingId)) throw new HiringError("job_closed", 404, "This job is no longer accepting applications.");
    const definition = await this.provider.jobInfo(jobPostingId);
    if (definition.formUnavailable) throw new HiringError("form_unavailable", 503, definition.formUnavailable);
    return definition;
  }
  async upload(input: UploadInput, session: string): Promise<{ url: string; fields: Record<string, string>; handle: string }> {
    this.ensureEnabled();
    const definition = await this.publishedDefinition(input.jobPostingId);
    if (!definition.fields.some(field => field.path === input.fieldPath && field.type === "File")) throw new HiringError("invalid_upload", 400, "This file is not part of the application form.");
    const upload = await this.provider.createUpload(input);
    await this.store.rememberUpload(await sha256(upload.handle), await sha256(session), input, Date.now() + 9 * 60 * 1000);
    return upload;
  }
  async submit(input: ApplicationInput, session: string): Promise<SubmissionResult> {
    const sessionHash = await sha256(session);
    const keyHash = await sha256(input.submissionKey);
    const fingerprint = await sha256(canonicalJson({ jobPostingId: input.jobPostingId, fieldSubmissions: [...input.fieldSubmissions].sort((a, b) => a.path.localeCompare(b.path)), utmData: input.utmData || null }));
    const existing = await this.store.find(keyHash);
    if (existing) return this.existingResult(existing, fingerprint, sessionHash);
    this.ensureEnabled();
    const definition = await this.publishedDefinition(input.jobPostingId);
    validateAnswers(input, definition.fields);
    for (const field of definition.fields.filter(f => f.type === "File")) {
      const answer = input.fieldSubmissions.find(f => f.path === field.path)?.value;
      if (answer == null || answer === "") continue;
      if (typeof answer !== "string" || !await this.store.ownsUpload(await sha256(answer), sessionHash, input.jobPostingId, field.path, Date.now())) throw new HiringError("invalid_upload", 422, "Your upload expired or is unavailable. Select the file again and retry.");
    }
    const receipt = privateToken();
    const now = Date.now();
    const claimed = await this.store.claim({ keyHash, sessionHash, fingerprint, jobPostingId: definition.job.id, jobTitle: definition.job.title, status: "pending", receiptHash: await sha256(receipt), submittedFormInstanceId: null, applicationId: null, createdAt: now, updatedAt: now });
    if (!claimed) {
      const winner = await this.store.find(keyHash);
      if (!winner) throw new HiringError("tracking_unavailable", 503, "We could not save your submission. Please try again later.");
      return this.existingResult(winner, fingerprint, sessionHash);
    }
    let outcome;
    try { outcome = await this.provider.submit(input); }
    catch (error) {
      if (error instanceof UncertainSubmissionError || !(error instanceof HiringError)) {
        // The record remains pending. A refresh must never replay a possibly successful write.
        await this.store.finish(keyHash, { updatedAt: Date.now() }, "upstream_outcome_unknown").catch(() => undefined);
        return { status: "pending", receipt, message: "We are checking your submission. Please do not submit again." };
      }
      await this.store.finish(keyHash, { status: "failed", updatedAt: Date.now() }, error.code);
      throw error;
    }
    if (outcome.blocked) {
      await this.store.finish(keyHash, { status: "blocked", updatedAt: Date.now() });
      return { status: "blocked", message: "We could not complete this application. Please contact the hiring team if you need assistance." };
    }
    // Store the upstream confirmation before any optional read or archival operation.
    try { await this.store.finish(keyHash, { status: "accepted", submittedFormInstanceId: outcome.submittedFormInstanceId!, updatedAt: Date.now() }); }
    catch { return { status: "pending", receipt, message: "We are checking your submission. Please do not submit again." }; }
    try {
      const applicationId = await this.provider.resolveApplicationId(outcome.submittedFormInstanceId!);
      await this.store.finish(keyHash, { applicationId, updatedAt: Date.now() });
      await this.archive?.(applicationId, `submission:${keyHash}`);
    } catch { /* A missed optional archive is recovered by the authenticated reconciliation task. */ }
    return { status: "accepted", receipt };
  }
  private async existingResult(record: Awaited<ReturnType<HiringStore["find"]>> & {}, fingerprint: string, sessionHash: string): Promise<SubmissionResult> {
    if (record.sessionHash !== sessionHash) throw new HiringError("submission_conflict", 409, "This submission belongs to a different browser session.");
    if (record.fingerprint !== fingerprint) throw new HiringError("submission_conflict", 409, "This submission is already being processed. Please do not change and resubmit it.");
    if (record.status === "accepted") {
      const receipt = privateToken();
      await this.store.addReceipt(record.keyHash, await sha256(receipt));
      return { status: "accepted", receipt };
    }
    if (record.status === "blocked") return { status: "blocked", message: "We could not complete this application. Please contact the hiring team if you need assistance." };
    if (record.status === "failed") throw new HiringError("submission_failed", 422, "The previous submission was not accepted. Check your answers and start a new submission attempt.");
    return { status: "pending", message: "We are checking your submission. Please do not submit again." };
  }
}
