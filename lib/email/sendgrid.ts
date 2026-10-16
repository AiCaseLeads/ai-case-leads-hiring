import type { MailInput } from "../google/gmail";
import { emailAddress, hash, utf8 } from "../google/http";
import { normalizedMessageId } from "../google/gmail";
import { AUTOMATIC_MAIL_DOMAIN, AUTOMATIC_SENDER, AUTOMATIC_REPLY_TO } from "./contracts";

// https://www.twilio.com/docs/sendgrid/api-reference/mail-send/mail-send
// https://www.twilio.com/docs/sendgrid/api-reference/domain-authentication/list-all-authenticated-domains
// https://www.twilio.com/docs/sendgrid/for-developers/sending-email/getting-started-email-activity-api

const API = "https://api.sendgrid.com/v3";
export const TRANSACTIONAL_MAIL_SENDER = AUTOMATIC_SENDER;
export const TRANSACTIONAL_MAIL_NAME = "AI Case Leads Recruiting";
// SendGrid Mail Send does not guarantee idempotency. NEVER retry an uncertain POST.
const READY_CACHE_MS = 5 * 60_000;
const MAX_RESPONSE_BYTES = 2 * 1024 * 1024;

export class SendGridError extends Error {
  constructor(public code: string, public status = 0, public uncertain = false, public retryAt?: number) {
    super(code); this.name = "SendGridError";
  }
}

export interface SendGridMailOptions {
  apiKey?: string;
  fetcher?: typeof fetch;
  /** An absolute processor deadline. No request may run beyond it. */
  deadlineAt?: number;
  now?: () => number;
  /** Test-only isolation. Production clients share verified readiness by key hash. */
  cacheReadiness?: boolean;
  /** Opt in only when the existing account already has the paid Activity API.
   * Signed Event Webhook evidence is the normal reconciliation path. */
  activityEnabled?: boolean;
}
export interface SendGridSenderReadiness {
  sender: typeof TRANSACTIONAL_MAIL_SENDER;
  domain: typeof AUTOMATIC_MAIL_DOMAIN;
  verified: true;
  accountId?: string;
}
/** Accepted by SendGrid is a different state from recipient delivery. No Gmail thread ID. */
export interface SendGridAcceptedMail {
  id: string;
  provider: "sendgrid";
  tag: string;
  accepted: true;
}
export interface SendGridReconciledMail extends SendGridAcceptedMail {
  outcome: "accepted" | "delivered" | "failed";
  event: string;
  delivered: boolean;
  failed: boolean;
}
const readinessCache = new Map<string, { value: SendGridSenderReadiness; checkedAt: number }>();
const readinessInFlight = new Map<string, Promise<SendGridSenderReadiness>>();
const readinessVersions = new Map<string, number>();

function keyValue(value: string | undefined): string {
  if (!value?.trim()) throw new SendGridError("transactional_mail_key_required");
  if (value !== value.trim() || value.length > 2048 || /[\s\u0000-\u001f\u007f]/.test(value)) throw new SendGridError("transactional_mail_auth_required");
  return value;
}
/** Safe to persist for account pinning; never return the API key or raw account data. */
export async function sendgridApiKeyFingerprint(apiKey?: string): Promise<string> {
  return hash(keyValue(apiKey ?? process.env.SENDGRID_API_KEY));
}

export async function sendgridMessageIdentity(value: string): Promise<{ messageId: string; tag: string }> {
  let messageId: string;
  try { messageId = normalizedMessageId(value); }
  catch { throw new SendGridError("transactional_mail_message_id_invalid"); }
  const digest = await hash(messageId);
  return { messageId, tag: digest };
}

function recipientAddress(value: string): string {
  try { return emailAddress(value).toLowerCase(); }
  catch { throw new SendGridError("transactional_mail_recipient_invalid"); }
}
function providerMessageId(value: unknown): string {
  if (typeof value !== "string" || !value || value.length > 500 || /[\s\u0000-\u001f\u007f]/.test(value)) throw new SendGridError("transactional_mail_response_invalid", 0, true);
  return value;
}
function escapedHtml(value: string): string {
  return value.replace(/[&<>"']/g, character => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character]!);
}
function retryTime(headers: Headers, now: number): number {
  const retry = headers.get("Retry-After");
  if (retry) {
    const seconds = Number(retry), date = Date.parse(retry);
    if (Number.isFinite(seconds) && seconds >= 0) return now + Math.max(1_000, Math.min(seconds * 1_000, 7 * 24 * 60 * 60_000));
    if (Number.isFinite(date) && date > now) return Math.min(date, now + 7 * 24 * 60 * 60_000);
  }
  const reset = Number(headers.get("x-ratelimit-reset")) * 1_000;
  return Number.isFinite(reset) && reset > now ? Math.min(reset, now + 24 * 60 * 60_000) : now + 60_000;
}
function record(value: unknown): Record<string, unknown> | null { return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null; }

/** Server-only transactional transport. No Gmail grant, sender alias, CC or BCC. */
export class SendGridMail {
  private readonly apiKey: string;
  private readonly fetcher: typeof fetch;
  private readonly now: () => number;
  private deadlineAt?: number;
  private readonly cacheReadiness: boolean;
  private readonly fingerprint: Promise<string>;
  private readonly activityEnabled: boolean;
  constructor(options: SendGridMailOptions = {}) {
    if (typeof window !== "undefined") throw new SendGridError("transactional_mail_server_only");
    this.apiKey = keyValue(options.apiKey ?? process.env.SENDGRID_API_KEY);
    this.fetcher = options.fetcher ?? fetch;
    this.now = options.now ?? Date.now;
    this.deadlineAt = options.deadlineAt;
    this.cacheReadiness = options.cacheReadiness !== false;
    this.fingerprint = hash(this.apiKey);
    this.activityEnabled = options.activityEnabled ?? process.env.SENDGRID_EMAIL_ACTIVITY_ENABLED === "true";
  }
  setDeadline(deadlineAt?: number): void { this.deadlineAt = deadlineAt; }
  async identityFingerprint(): Promise<string> { return this.fingerprint; }

  private async invalidateReadiness(): Promise<void> {
    const key = await this.fingerprint;
    readinessCache.delete(key);
    readinessVersions.set(key, (readinessVersions.get(key) ?? 0) + 1);
  }

  private async request(path: string, init: RequestInit = {}, write = false): Promise<{ response: Response; body?: unknown }> {
    const now = this.now(), remaining = this.deadlineAt === undefined ? 20_000 : this.deadlineAt - now;
    if (remaining <= 0) throw new SendGridError("processor_deadline_exceeded");
    const signal = AbortSignal.timeout(Math.max(1, Math.floor(Math.min(20_000, remaining))));
    let response: Response;
    try {
      response = await this.fetcher(`${API}${path}`, { ...init, redirect: "manual", signal, headers: { Authorization: `Bearer ${this.apiKey}`, Accept: "application/json", "Content-Type": "application/json" } });
    } catch { throw new SendGridError("transactional_mail_network_error", 0, write); }
    if (response.status >= 300 && response.status < 400) throw new SendGridError("transactional_mail_redirect_rejected", response.status, write);
    // A server error or timeout can follow acceptance: never turn it into a safe retry.
    if (response.status >= 500 || response.status === 408) throw new SendGridError("transactional_mail_provider_error", response.status, write);
    if (response.status === 401) { await this.invalidateReadiness(); throw new SendGridError("transactional_mail_auth_required", response.status); }
    if (response.status === 429) throw new SendGridError("transactional_mail_rate_limited", response.status, false, retryTime(response.headers, now));
    if (write && response.ok) return { response }; // 202 has an empty body.
    const body = await this.readResponse(response, signal, write && response.ok);
    if (!response.ok) {
      const errors = record(body)?.errors;
      const messages = Array.isArray(errors) ? errors.slice(0, 20).map(item => record(item)?.message).filter((item): item is string => typeof item === "string") : [];
      if (response.status === 402 || messages.some(message => /maximum credits exceeded|credits? (?:are )?exceeded|daily (?:sending |email )?limit|monthly (?:sending |email )?limit/i.test(message))) {
        const nextDay = Math.floor(now / 86_400_000) * 86_400_000 + 86_400_000;
        throw new SendGridError("transactional_mail_quota_exhausted", response.status, false, nextDay);
      }
      if (messages.some(message => /does not match a verified sender|sender identity|domain (?:is )?not (?:verified|authenticated)/i.test(message))) { await this.invalidateReadiness(); throw new SendGridError("transactional_mail_domain_not_verified", response.status); }
      if (messages.some(message => /account (?:is )?(?:disabled|suspended|under review)|account.*not (?:activated|enabled)/i.test(message))) { await this.invalidateReadiness(); throw new SendGridError("transactional_mail_account_not_enabled", response.status); }
      if (response.status === 403) { await this.invalidateReadiness(); throw new SendGridError("transactional_mail_auth_required", response.status); }
      await this.invalidateReadiness();
      throw new SendGridError("transactional_mail_request_rejected", response.status);
    }
    return { response, body };
  }

  private async readResponse(response: Response, signal: AbortSignal, uncertain: boolean): Promise<unknown> {
    let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
    let onAbort: (() => void) | undefined;
    try {
      if (!response.body) throw new Error("empty");
      reader = response.body.getReader();
      const aborted = new Promise<never>((_, reject) => {
        onAbort = () => reject(new Error("timeout"));
        signal.addEventListener("abort", onAbort, { once: true });
        if (signal.aborted) onAbort();
      });
      const chunks: Uint8Array[] = [];
      let size = 0;
      while (true) {
        const part = await Promise.race([reader.read(), aborted]);
        if (part.done) break;
        size += part.value.byteLength;
        if (size > MAX_RESPONSE_BYTES) throw new Error("oversized");
        chunks.push(part.value);
      }
      const bytes = new Uint8Array(size); let offset = 0;
      for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
      const value: unknown = JSON.parse(new TextDecoder().decode(bytes));
      if (!value || typeof value !== "object") throw new Error("invalid");
      return value;
    } catch {
      void reader?.cancel().catch(() => undefined);
      throw new SendGridError("transactional_mail_response_invalid", response.status, uncertain);
    } finally { if (onAbort) signal.removeEventListener("abort", onAbort); }
  }

  /** Only successful readiness is cached by SHA256 key fingerprint for five minutes. */
  async verifySender(force = false): Promise<SendGridSenderReadiness> {
    if (this.deadlineAt !== undefined && this.deadlineAt <= this.now()) throw new SendGridError("processor_deadline_exceeded");
    if (!this.cacheReadiness) return this.checkSender();
    const key = await this.fingerprint, now = this.now(), ready = readinessCache.get(key);
    if (!force && ready && now >= ready.checkedAt && now - ready.checkedAt < READY_CACHE_MS) return ready.value;
    readinessCache.delete(key);
    let pending = readinessInFlight.get(key);
    if (!pending) {
      const version = readinessVersions.get(key) ?? 0;
      pending = this.checkSender().then(value => {
        if (version !== (readinessVersions.get(key) ?? 0)) throw new SendGridError("transactional_mail_auth_required");
        if (readinessCache.size >= 8) readinessCache.delete(readinessCache.keys().next().value!);
        readinessCache.set(key, { value, checkedAt: this.now() });
        return value;
      }).finally(() => { if (readinessInFlight.get(key) === pending) readinessInFlight.delete(key); });
      readinessInFlight.set(key, pending);
    }
    if (this.deadlineAt === undefined) return pending;
    const remaining = this.deadlineAt - this.now();
    if (remaining <= 0) throw new SendGridError("processor_deadline_exceeded");
    let timeout: ReturnType<typeof setTimeout> | undefined;
    try {
      return await Promise.race([pending, new Promise<never>((_, reject) => { timeout = setTimeout(() => reject(new SendGridError("processor_deadline_exceeded")), remaining); })]);
    } finally { if (timeout) clearTimeout(timeout); }
  }

  private async checkSender(): Promise<SendGridSenderReadiness> {
    for (let page = 0; page < 10; page++) {
      const { body } = await this.request(`/whitelabel/domains?limit=100&offset=${page * 100}`);
      if (!Array.isArray(body) || body.length > 100) throw new SendGridError("transactional_mail_response_invalid");
      const domain = body.map(record).find(domain => domain && typeof domain.domain === "string" && domain.domain.toLowerCase() === AUTOMATIC_MAIL_DOMAIN && domain.valid === true);
      if (domain) {
        const accountId = Number.isSafeInteger(domain.user_id) && Number(domain.user_id) > 0 ? `sendgrid-user-${domain.user_id}` : undefined;
        return { sender: TRANSACTIONAL_MAIL_SENDER, domain: AUTOMATIC_MAIL_DOMAIN, verified: true, ...(accountId ? { accountId } : {}) };
      }
      if (body.length < 100) break;
    }
    throw new SendGridError("transactional_mail_domain_not_verified");
  }

  async send(input: MailInput): Promise<SendGridAcceptedMail> {
    const to = recipientAddress(input.to);
    if (input.sender !== undefined && (typeof input.sender !== "string" || input.sender.toLowerCase() !== TRANSACTIONAL_MAIL_SENDER)) throw new SendGridError("transactional_mail_sender_not_allowed");
    if (input.replyTo !== undefined && (!Array.isArray(input.replyTo) || input.replyTo.length !== 1 || typeof input.replyTo[0] !== "string" || input.replyTo[0].toLowerCase() !== AUTOMATIC_REPLY_TO)) throw new SendGridError("transactional_mail_reply_to_not_allowed");
    if (typeof input.subject !== "string" || !input.subject || input.subject.length > 500 || /[\u0000-\u001f\u007f]/.test(input.subject)) throw new SendGridError("transactional_mail_subject_invalid");
    if (typeof input.body !== "string" || utf8(input.body).length > 1_000_000) throw new SendGridError("transactional_mail_body_invalid");
    const identity = await sendgridMessageIdentity(input.messageId);
    await this.verifySender();
    const { response } = await this.request("/mail/send", { method: "POST", body: JSON.stringify({
      from: { email: TRANSACTIONAL_MAIL_SENDER, name: TRANSACTIONAL_MAIL_NAME },
      personalizations: [{ to: [{ email: to }], custom_args: { aicl_message: identity.tag } }],
      reply_to: { email: AUTOMATIC_REPLY_TO, name: TRANSACTIONAL_MAIL_NAME }, subject: input.subject,
      content: [{ type: "text/plain", value: input.body }, { type: "text/html", value: `<html><body><div style="white-space:pre-wrap;font-family:Arial,sans-serif">${escapedHtml(input.body)}</div></body></html>` }],
      headers: { "X-AICL-Message-ID": identity.messageId },
      tracking_settings: { click_tracking: { enable: false, enable_text: false }, open_tracking: { enable: false } },
    }) }, true);
    if (response.status !== 202) throw new SendGridError("transactional_mail_response_invalid", response.status, true);
    return { id: providerMessageId(response.headers.get("x-message-id")), provider: "sendgrid", tag: identity.tag, accepted: true };
  }

  /** Optional read-only Activity API evidence. It requires an existing paid
   * history entitlement, so it is disabled by default; never buy an add-on here.
   * null is unresolved, never proof that an uncertain POST is safe to resend. */
  async reconcile(messageId: string, recipient: string, options: { days?: number; providerMessageId?: string } = {}): Promise<SendGridReconciledMail | null> {
    const to = recipientAddress(recipient), identity = await sendgridMessageIdentity(messageId), days = options.days ?? 30;
    if (!Number.isSafeInteger(days) || days < 1 || days > 90) throw new SendGridError("transactional_mail_reconciliation_range_invalid");
    const pinnedId = options.providerMessageId === undefined ? undefined : providerMessageId(options.providerMessageId);
    if (!this.activityEnabled) return null;
    const since = new Date(this.now() - days * 86_400_000).toISOString();
    const query = `(unique_args['aicl_message']="${identity.tag}") AND to_email="${to}" AND from_email="${TRANSACTIONAL_MAIL_SENDER}" AND last_event_time>TIMESTAMP "${since}"`;
    try {
      const { body } = await this.request(`/messages?${new URLSearchParams({ limit: "10", query })}`);
      const messages = record(body)?.messages;
      if (!Array.isArray(messages)) throw new SendGridError("transactional_mail_reconciliation_invalid");
      if (messages.length >= 10) throw new SendGridError("transactional_mail_reconciliation_too_large", 0, true);
      const matches: Array<{ id: string; status: string }> = [];
      for (const value of messages) {
        const summary = record(value);
        if (!summary || summary.to_email !== to || summary.from_email !== TRANSACTIONAL_MAIL_SENDER) continue;
        const id = providerMessageId(summary.msg_id);
        const detail = record((await this.request(`/messages/${encodeURIComponent(id)}`)).body);
        if (!detail || detail.msg_id !== id || detail.to_email !== to || detail.from_email !== TRANSACTIONAL_MAIL_SENDER) continue;
        let args: unknown = detail.unique_args;
        if (typeof args === "string") { try { args = JSON.parse(args); } catch { throw new SendGridError("transactional_mail_reconciliation_invalid"); } }
        if (record(args)?.aicl_message !== identity.tag) continue;
        if (typeof detail.status !== "string" || !["processed", "processing", "delivered", "not_delivered"].includes(detail.status)) throw new SendGridError("transactional_mail_reconciliation_invalid");
        matches.push({ id, status: detail.status });
      }
      if (new Set(matches.map(match => match.id)).size > 1) throw new SendGridError("transactional_mail_duplicate_message", 0, true);
      if (!matches.length) return null;
      const match = matches[0], delivered = match.status === "delivered", failed = match.status === "not_delivered";
      // Activity msg_id and the 202 X-Message-ID are different provider identifiers.
      // Keep the original accepted ID when supplied; never invent a Gmail thread.
      return { id: pinnedId ?? match.id, provider: "sendgrid", tag: identity.tag, accepted: true, outcome: delivered ? "delivered" : failed ? "failed" : "accepted", event: match.status, delivered, failed };
    } catch (error) {
      // Missing Activity entitlement/scope is an expected optional limitation.
      if (error instanceof SendGridError && [403, 404].includes(error.status)) return null;
      throw error;
    }
  }
}
