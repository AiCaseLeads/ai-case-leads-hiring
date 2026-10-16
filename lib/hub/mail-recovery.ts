import { z } from "zod";
import type { HubMember } from "./auth";
import type { HubStore } from "./store";
import type { Task } from "./types";
import { applicationTrash } from "./application-lifecycle";
import { candidateMail, CANDIDATE_SENDER, jobNotificationMail } from "../job-team/service";
import { reviewReminderMail } from "../review-reminders/service";
import { personalMailWorkspace, type PersonalMailEnv } from "../personal-mail/service";
import { canonicalJson, privateToken, sha256 } from "../hiring/crypto";
import { HiringError } from "../hiring/errors";
import type { MailInput } from "../google/gmail";
import { candidateTaskMailMode } from "../google/mail-setup";

const LIMIT = 200;
const PLAN_MS = 10 * 60_000;
const windowInput = z.object({ from: z.number().int().nonnegative(), to: z.number().int().positive() }).strict();
const executeInput = z.object({ planId: z.string().regex(/^[a-f0-9]{64}$/), digest: z.string().regex(/^[a-f0-9]{64}$/) }).strict();
type Row = { id: string; application_id: string; payload_json: string; status: Task["status"]; attempts: number; run_after: number; lease_token: string | null; lease_until: number | null; last_error: string | null; result_json: string | null; created_at: number; updated_at: number; app_revision: number; app_stage: string; app_stage_entered_at: number; app_email: string; app_name: string; job_title: string; communication_status: string | null; communication_updated_at: number | null; provider_id: string | null; thread_id: string | null };
type RecoveryTransport = { verifyMailSender: (sender: string, account?: string, candidateMail?: boolean) => Promise<unknown>; setDeadline?: (value?: number) => void };
export type RecoveryDependencies = { env: PersonalMailEnv; resolve?: (account: string) => Promise<RecoveryTransport | null>; now?: () => number };
type Planned = { id: string; snapshot: string; envelope: string };
type Plan = { actor: string; from: number; to: number; expiresAt: number; digest: string; items: Planned[]; consumed?: { queued: number; at: number } };
type MailKind = "Application receipt" | "Automatic rejection" | "Recruiter message" | "Assessment invitation" | "Interview invitation" | "Recruiter rejection" | "Team notification" | "Review reminder";
export type RecoveryPreview = { planId: string | null; digest: string | null; expiresAt: number | null; eligible: number; remaining: number; scanned: number; counts: Partial<Record<MailKind, number>>; skipped: Array<{ reason: string; count: number }>; messages: Array<{ id: string; applicant: string; job: string; kind: MailKind; sender: string; replyTo: string[]; subject: string }>; automaticSender: string; privacy: string };

const columns = "t.*,a.revision AS app_revision,a.stage AS app_stage,a.stage_entered_at AS app_stage_entered_at,a.email AS app_email,a.name AS app_name,a.job_title,c.status AS communication_status,c.updated_at AS communication_updated_at,c.provider_id,c.thread_id";
const joins = "FROM hub_tasks t JOIN hub_applications a ON a.id=t.application_id LEFT JOIN hub_communications c ON c.task_id=t.id";
function admin(member: HubMember) { if (member.role !== "admin") throw new HiringError("admin_access_required", 403, "Only managers can recover historical email deliveries."); }
function kind(row: Row, payload: Record<string, unknown>): MailKind | null {
  const prefix = `gmail:${row.application_id}:`;
  if (row.id === prefix + "confirmation") return "Application receipt";
  if (row.id === prefix + "rejection") return "Automatic rejection";
  if (row.id.startsWith(prefix + "manual:") && payload.mailMode === "recruiter" && typeof payload.actor === "string") return "Recruiter message";
  if (row.id.startsWith(prefix + "rejection:") && payload.mailMode === "recruiter") return "Recruiter rejection";
  if (row.id.startsWith(prefix + "assessment:") && payload.mailMode === "recruiter") return "Assessment invitation";
  if (row.id.startsWith(prefix + "interview:") && payload.mailMode === "recruiter") return "Interview invitation";
  if (payload.jobNotification === true) return "Team notification";
  if (payload.reviewReminder === true) return "Review reminder";
  return null;
}
function task(row: Row, payload: Record<string, unknown>): Task { return { id: row.id, applicationId: row.application_id, kind: "gmail", status: row.status, attempts: row.attempts, payload, createdAt: row.created_at, updatedAt: row.updated_at, runAfter: row.run_after, leaseToken: row.lease_token, leaseUntil: row.lease_until, lastError: row.last_error }; }
function safeIssue(error: unknown): string {
  const code = error && typeof error === "object" && "code" in error ? error.code : "";
  const status = error && typeof error === "object" && "status" in error ? error.status : 0;
  if (status === 401 || status === 403) return "Google authorization or sender-settings permission needs attention";
  return ({ candidate_mail_account_not_configured: "Assign the automatic recruiting mailbox", candidate_mail_account_connection_required: "Recruiting Gmail needs to be connected", gmail_sender_alias_not_verified: "The no-reply sender is not verified in Gmail", candidate_mail_exposes_staff_address: "Email content includes a private staff address", recruiter_reply_contact_required: "This job needs a recruiter reply contact", google_oauth_reconnect_required: "Reconnect recruiting Gmail", google_permission_or_auth_required: "Google authorization or sender-settings permission needs attention", google_required_permissions_missing: "Google email permissions are incomplete" } as Record<string, string>)[String(code)] || "Google email readiness could not be verified";
}
async function envelope(store: HubStore, row: Row, env: PersonalMailEnv, now: number): Promise<{ kind: MailKind; mail: MailInput } | { reason: string }> {
  if (row.status !== "failed") return { reason: row.status === "uncertain" ? "Delivery uncertain; checking sent mail, never resend blindly" : row.status === "done" ? "Already completed or cancelled" : "Pending or being processed" };
  if (row.provider_id || row.thread_id || ["sent", "uncertain", "cancelled"].includes(row.communication_status || "")) return { reason: "A sent, uncertain or cancelled delivery record already exists" };
  if (await applicationTrash(store, row.application_id)) return { reason: "Application is in Trash" };
  let payload: Record<string, unknown>;
  try { payload = JSON.parse(row.payload_json); if (!payload || typeof payload !== "object" || Array.isArray(payload)) throw new Error(); } catch { return { reason: "Message payload cannot be read" }; }
  const messageKind = kind(row, payload);
  if (!messageKind) return { reason: "Message needs individual review before recovery" };
  const internal = messageKind === "Team notification" || messageKind === "Review reminder";
  if (!internal && row.communication_status === null) return { reason: "Original approved communication record is missing" };
  if (["Automatic rejection", "Recruiter rejection"].includes(messageKind) && (row.app_stage !== "Rejected" || row.created_at < row.app_stage_entered_at)) return { reason: "Rejection decision is no longer current" };
  if (["Assessment invitation", "Interview invitation"].includes(messageKind)) {
    if (["Rejected", "Withdrawn", "Hired"].includes(row.app_stage)) return { reason: "Invitation belongs to an inactive application" };
    const linkKind = messageKind === "Assessment invitation" ? "assessment" : "interview";
    const url = typeof payload.body === "string" ? new RegExp(`https?:\\/\\/[^\\s]+\\/${linkKind}\\/([a-f0-9]{64})(?:\\s|$)`).exec(payload.body) : null;
    if (!url) return { reason: "Invitation link needs individual review" };
    const link = await store.db.prepare("SELECT expires_at,used_at FROM hub_links WHERE token_hash=? AND application_id=? AND kind=?").bind(await sha256(url[1]), row.application_id, linkKind).first<{ expires_at: number; used_at: number | null }>();
    if (!link || link.used_at !== null || link.expires_at <= now + 5 * 60_000) return { reason: "Invitation link expired or was replaced; renew the invitation" };
  }
  try {
    const owners = (env.ADMIN_EMAILS || "").split(",");
    let mail: MailInput | null;
    if (messageKind === "Team notification") mail = await jobNotificationMail(task(row, payload), store, owners);
    else if (messageKind === "Review reminder") mail = await reviewReminderMail(task(row, payload), store, owners);
    else {
      if (typeof payload.to !== "string" || payload.to.toLowerCase() !== row.app_email.toLowerCase() || !["subject", "body", "messageId"].every(key => typeof payload[key] === "string")) return { reason: "Recipient or original message identity needs individual review" };
      mail = await candidateMail(store, payload as unknown as MailInput, owners, { mailMode: candidateTaskMailMode(row.id, row.application_id, payload), actor: payload.actor, applicationId: row.application_id });
    }
    if (!mail || mail.to.toLowerCase() === "sales@aicaseleads.com") return { reason: "Notification is no longer current or owner notifications are disabled" };
    return { kind: messageKind, mail: { ...mail, candidateAccount: internal ? process.env.CANDIDATE_MAIL_ACCOUNT?.trim().toLowerCase() : mail.candidateAccount } };
  } catch (error) { return { reason: safeIssue(error) }; }
}
async function verify(mail: MailInput, store: HubStore, deps: RecoveryDependencies, checked: Map<string, string | null>): Promise<string | null> {
  const account = mail.candidateAccount?.toLowerCase(), sender = mail.sender || account;
  if (!account || account === "sales@aicaseleads.com" || !sender) return "Assign the automatic recruiting mailbox";
  const key = `${account}:${sender}`;
  if (checked.has(key)) return checked.get(key)!;
  let issue: string | null = null;
  try {
    const transport = deps.resolve ? await deps.resolve(account) : await personalMailWorkspace(store, account, deps.env);
    if (!transport) throw { code: "candidate_mail_account_connection_required" };
    transport.setDeadline?.(Date.now() + 20_000);
    await transport.verifyMailSender(sender, account, true);
  } catch (error) { issue = safeIssue(error); }
  checked.set(key, issue);
  return issue;
}
export async function previewMailRecovery(store: HubStore, member: HubMember, input: unknown, deps: RecoveryDependencies): Promise<RecoveryPreview> {
  admin(member);
  const parsed = windowInput.safeParse(input), now = deps.now?.() ?? Date.now();
  if (!parsed.success || parsed.data.to <= parsed.data.from || parsed.data.to - parsed.data.from > 7 * 86400_000 || parsed.data.to > now + 86400_000) throw new HiringError("invalid_recovery_window", 422, "Choose an email date range of no more than seven days.");
  const { from, to } = parsed.data;
  const rows = await store.rows<Row>(`SELECT ${columns} ${joins} WHERE t.kind='gmail' AND t.created_at>=? AND t.created_at<? ORDER BY CASE WHEN t.id='gmail:'||t.application_id||':confirmation' THEN 0 ELSE 1 END,t.created_at,t.id LIMIT 5001`, from, to);
  if (rows.length > 5000) throw new HiringError("recovery_window_too_large", 422, "Choose a shorter email date range.");
  const reasons = new Map<string, number>(), checked = new Map<string, string | null>(), items: Planned[] = [], messages: RecoveryPreview["messages"] = [], counts: RecoveryPreview["counts"] = {};
  let remaining = 0;
  for (const row of rows) {
    const built = await envelope(store, row, deps.env, now);
    const reason = "reason" in built ? built.reason : await verify(built.mail, store, deps, checked);
    if (reason) { reasons.set(reason, (reasons.get(reason) || 0) + 1); continue; }
    if ("reason" in built) continue;
    if (items.length >= LIMIT) { remaining++; continue; }
    items.push({ id: row.id, snapshot: await sha256(canonicalJson(row)), envelope: await sha256(canonicalJson(built.mail)) });
    counts[built.kind] = (counts[built.kind] || 0) + 1;
    messages.push({ id: row.id, applicant: row.app_name, job: row.job_title, kind: built.kind, sender: built.mail.sender || built.mail.candidateAccount!, replyTo: built.mail.replyTo || [], subject: built.mail.subject });
  }
  const planId = items.length ? privateToken() : null, expiresAt = items.length ? now + PLAN_MS : null;
  const digest = items.length ? await sha256(canonicalJson({ actor: member.email, from, to, items })) : null;
  if (planId) await store.setSetting(`mail_recovery_plan:${planId}`, { actor: member.email, from, to, expiresAt: expiresAt!, digest: digest!, items } satisfies Plan);
  return { planId, digest, expiresAt, eligible: items.length, remaining, scanned: rows.length, counts, skipped: [...reasons].map(([reason, count]) => ({ reason, count })), messages, automaticSender: CANDIDATE_SENDER, privacy: "Application receipts use no-reply in From and Reply-To, with no staff CC/BCC. Recruiter messages use the assigned recruiter. Actual recipient headers must be checked in a controlled delivery." };
}
export async function executeMailRecovery(store: HubStore, member: HubMember, input: unknown, deps: RecoveryDependencies): Promise<{ queued: number; alreadyQueued: boolean }> {
  admin(member);
  const parsed = executeInput.safeParse(input), now = deps.now?.() ?? Date.now();
  if (!parsed.success) throw new HiringError("invalid_recovery_plan", 422, "Preview the failed emails before retrying.");
  const key = `mail_recovery_plan:${parsed.data.planId}`;
  const plan = await store.setting<Plan | null>(key, null);
  if (!plan || plan.actor !== member.email || plan.digest !== parsed.data.digest) throw new HiringError("recovery_plan_unavailable", 409, "This recovery plan is unavailable. Preview the failed emails again.");
  if (plan.consumed) return { queued: plan.consumed.queued, alreadyQueued: true };
  if (plan.expiresAt <= now || !plan.items.length || plan.items.length > LIMIT) throw new HiringError("recovery_plan_expired", 409, "This preview expired. Preview the failed emails again.");
  const rows = await store.rows<Row>(`SELECT ${columns} ${joins} WHERE t.id IN (${plan.items.map(() => "?").join(",")})`, ...plan.items.map(item => item.id));
  const byId = new Map(rows.map(row => [row.id, row])), checked = new Map<string, string | null>();
  for (const expected of plan.items) {
    const row = byId.get(expected.id);
    if (!row || await sha256(canonicalJson(row)) !== expected.snapshot) throw new HiringError("recovery_plan_changed", 409, "An email or applicant changed after the preview. Preview again; no emails were queued.");
    const built = await envelope(store, row, deps.env, now);
    if ("reason" in built || await sha256(canonicalJson(built.mail)) !== expected.envelope) throw new HiringError("recovery_plan_changed", 409, "Email routing, content or invitation eligibility changed. Preview again; no emails were queued.");
    const issue = await verify(built.mail, store, deps, checked);
    if (issue) throw new HiringError("mail_not_ready", 409, issue + ". No emails were queued.");
  }
  // One transaction guards every exact previewed record. Any race aborts the whole plan.
  const statements: D1PreparedStatement[] = [store.db.prepare("INSERT INTO hub_settings(key,value,updated_at) VALUES(?,CASE WHEN (SELECT value FROM hub_settings WHERE key=?)=? THEN ? ELSE NULL END,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value,updated_at=excluded.updated_at").bind(key, key, JSON.stringify(plan), JSON.stringify({ ...plan, consumed: { queued: rows.length, at: now } }), now)];
  for (const row of rows) {
    statements.push(store.db.prepare("UPDATE hub_tasks SET run_after=CASE WHEN status='failed' AND attempts=? AND updated_at=? AND lease_token IS ? AND payload_json=? AND result_json IS ? AND last_error IS ? AND EXISTS(SELECT 1 FROM hub_applications a WHERE a.id=application_id AND a.revision=?) AND NOT EXISTS(SELECT 1 FROM hub_settings s WHERE s.key='application_trash:'||application_id) AND ((? IS NULL AND NOT EXISTS(SELECT 1 FROM hub_communications c WHERE c.task_id=hub_tasks.id)) OR EXISTS(SELECT 1 FROM hub_communications c WHERE c.task_id=hub_tasks.id AND c.status=? AND c.updated_at=? AND c.provider_id IS NULL AND c.thread_id IS NULL)) THEN ? ELSE NULL END,status='pending',attempts=0,lease_token=NULL,lease_until=NULL,last_error=NULL,result_json=NULL,updated_at=? WHERE id=?").bind(row.attempts, row.updated_at, row.lease_token, row.payload_json, row.result_json, row.last_error, row.app_revision, row.communication_status, row.communication_status, row.communication_updated_at, now, now, row.id));
    statements.push(store.db.prepare("UPDATE hub_communications SET status='pending',updated_at=? WHERE task_id=? AND provider_id IS NULL AND thread_id IS NULL").bind(now, row.id));
    statements.push(store.db.prepare("INSERT INTO hub_history(id,application_id,type,text,actor,created_at) VALUES(?,?,'email_recovery',?,?,?)").bind(`recovery:${parsed.data.planId}:${row.id}`, row.application_id, "Previously queued email released for safe delivery after mailbox and sender verification.", member.email, now));
  }
  try {
    const results = await store.db.batch(statements);
    if (results[0].meta.changes !== 1) throw new Error("recovery_plan_lost");
  } catch { throw new HiringError("recovery_plan_changed", 409, "An email changed during recovery. Preview again; no emails were queued."); }
  return { queued: rows.length, alreadyQueued: false };
}
