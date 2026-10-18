import type { ApplicationInput, HiringProvider, UploadInput } from "./types";
import { HubStore, applicationIdForSubmissionKey } from "../hub/store";
import { HiringError } from "./errors";
import { canonicalJson, privateToken, sha256 } from "./crypto";
import { D1HiringStore } from "./store";
import { validateAnswers } from "./validation";
import type { SubmissionResult } from "./service";

export class LocalHiringProvider implements HiringProvider {
  private hub: HubStore;
  constructor(private db: D1Database, private session?: string, private origin?: string) { this.hub = new HubStore(db); }
  listJobs() { return this.hub.listPublishedJobs(); }
  jobInfo(id: string) { return this.hub.jobDefinition(id); }
  async createUpload(input: UploadInput) {
    if (!this.session || !this.origin) throw new HiringError("session_required", 409, "Refresh the application before uploading.");
    const handle = privateToken(), id = await sha256(handle), now = Date.now();
    await this.db.prepare("INSERT INTO hub_files (id,job_id,field_path,filename,content_type,size,object_key,uploaded_at,application_id,expires_at,session_hash) VALUES (?,?,?,?,?,?,?,NULL,NULL,?,?)")
      .bind(id,input.jobPostingId,input.fieldPath,input.filename,input.contentType,input.contentLength,`applications/${id}`,now+9*60*1000,await sha256(this.session)).run();
    return { url: `${this.origin}/api/uploads/${handle}`, fields: {}, handle };
  }
  async submit(): Promise<never> { throw new Error("Local applications require an atomic local submission."); }
  async resolveApplicationId(id: string) { return id; }
}

export class LocalHiringStore extends D1HiringStore {
  constructor(private database: D1Database) { super(database); }
  async ownsUpload(handleHash: string, sessionHash: string, jobId: string, fieldPath: string, now: number): Promise<boolean> {
    return !!await this.database.prepare("SELECT id FROM hub_files WHERE id=? AND session_hash=? AND job_id=? AND field_path=? AND expires_at>? AND uploaded_at>0 AND application_id IS NULL")
      .bind(handleHash,sessionHash,jobId,fieldPath,now).first();
  }
}

export async function acceptLocalApplication(db: D1Database, input: ApplicationInput, session: string, enabled: boolean, requireFormVersion=false): Promise<SubmissionResult> {
  const keyHash = await sha256(input.submissionKey), sessionHash = await sha256(session);
  const fingerprint = await sha256(canonicalJson({ jobPostingId: input.jobPostingId, fieldSubmissions: [...input.fieldSubmissions].sort((a,b)=>a.path.localeCompare(b.path)), utmData: input.utmData || null,formVersion:input.formVersion??null }));
  const tracker = new D1HiringStore(db);
  const existing = await tracker.find(keyHash);
  const check = (record: NonNullable<typeof existing>) => {
    if (record.sessionHash !== sessionHash || record.fingerprint !== fingerprint) throw new HiringError("submission_conflict",409,"This submission is already saved with different answers or belongs to another browser.");
    if (record.status !== "accepted") throw new HiringError("submission_pending",409,"Your earlier submission needs review. Please contact the hiring team.");
  };
  if (existing) {
    check(existing);
    const receipt = privateToken(); await tracker.addReceipt(keyHash,await sha256(receipt));
    return {status:"accepted",receipt};
  }
  if (!enabled) throw new HiringError("applications_disabled",503,"Applications are not open yet. Please check back soon.");
  const hub = new HubStore(db,{sessionHash});
  const definition = await hub.jobDefinition(input.jobPostingId);
  if((requireFormVersion&&input.formVersion===undefined)||(input.formVersion!==undefined&&input.formVersion!==definition.formVersion))throw new HiringError("form_changed",422,"The role or application questions changed. Refresh this page and review the current questions before submitting.");
  if(!input.fieldSubmissions.some(answer=>answer.path==="_systemfield_phone"))throw new HiringError("invalid_application",422,"Refresh this application form and include your phone number with + and country code.",{_systemfield_phone:"Phone number is required, including + and country code."});
  validateAnswers(input,definition.fields);
  const receipt = privateToken(), receiptHash = await sha256(receipt), appId = await applicationIdForSubmissionKey(input.submissionKey), now = Date.now();
  const statements = [db.prepare("INSERT INTO hiring_submissions (key_hash,session_hash,fingerprint,job_posting_id,job_title,status,receipt_hash,submitted_form_instance_id,application_id,created_at,updated_at) VALUES (?,?,?,?,?,'accepted',?,?,?,?,?) ON CONFLICT(key_hash) DO NOTHING")
    .bind(keyHash,sessionHash,fingerprint,input.jobPostingId,definition.job.title,receiptHash,appId,appId,now,now)];
  try {
    await hub.acceptApplication(input,sessionHash,statements,true);
  } catch (error) {
    // Another identical request can commit while this request validates its file.
    // Its now-attached upload is no longer unclaimed, but the accepted receipt wins.
    const winner = await tracker.find(keyHash);
    if (!winner) throw error;
    check(winner);
    await tracker.addReceipt(keyHash,receiptHash);
    return {status:"accepted",receipt};
  }
  const accepted = await tracker.find(keyHash);
  if (!accepted) throw new HiringError("tracking_unavailable",503,"We could not confirm your application. Retry with the same submission.");
  check(accepted);
  if (accepted.receiptHash !== receiptHash) await tracker.addReceipt(keyHash,receiptHash);
  return {status:"accepted",receipt};
}
