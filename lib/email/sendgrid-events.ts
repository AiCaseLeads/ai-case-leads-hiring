import { z } from "zod";
import type { HubStore } from "../hub/store";
import { HiringError } from "../hiring/errors";
import { sha256 } from "../hiring/crypto";
import { normalizedMessageId } from "../google/gmail";
import { boundedBytes } from "../hiring/files";
import { errorResponse, jsonResponse } from "../hiring/http";

export const SENDGRID_SIGNATURE_HEADER = "X-Twilio-Email-Event-Webhook-Signature";
export const SENDGRID_TIMESTAMP_HEADER = "X-Twilio-Email-Event-Webhook-Timestamp";
export const SENDGRID_EVENT_MAX_BYTES = 512 * 1024;
const MAX_EVENTS = 1_000, MAX_CLOCK_SKEW_SECONDS = 300;
const eventSchema = z.object({
  sg_event_id: z.string().min(1).max(512).regex(/^[\x21-\x7e]+$/),
  sg_message_id: z.string().trim().min(1).max(512).regex(/^[\x21-\x7e]+$/).optional(),
  email: z.string().trim().email().max(254).transform(value => value.toLowerCase()),
  timestamp: z.union([z.number(), z.string().regex(/^\d{1,12}$/).transform(Number)]).pipe(z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER)),
  event: z.enum(["processed", "delivered", "deferred", "bounce", "dropped", "open", "click", "spamreport", "unsubscribe", "group_unsubscribe", "group_resubscribe"]),
  aicl_message: z.string().regex(/^[a-f0-9]{64}$/).optional(),
});
type StoredSendgridEvent = { eventId: string; messageId: string; email: string; tag: string; event: z.infer<typeof eventSchema>["event"]; timestamp: number; receivedAt: number };
type StoreSource = HubStore | (() => Promise<HubStore>);

function unauthorized(): never { throw new HiringError("sendgrid_signature_invalid", 401, "The email event signature could not be verified."); }
function base64(value: string, maxLength: number): Uint8Array {
  if (!value || value.length > maxLength || value.length % 4 !== 0 || !/^[A-Za-z0-9+/]+={0,2}$/.test(value)) return unauthorized();
  try {
    const decoded = atob(value);
    if (btoa(decoded) !== value) return unauthorized();
    return Uint8Array.from(decoded, character => character.charCodeAt(0));
  } catch { return unauthorized(); }
}
/** SendGrid transmits ASN.1 DER ECDSA; WebCrypto verifies a 64-byte P1363 signature. */
function p1363(signature: Uint8Array): Uint8Array {
  if (signature.length < 8 || signature.length > 72 || signature[0] !== 0x30 || signature[1] !== signature.length - 2) return unauthorized();
  const result = new Uint8Array(64); let offset = 2;
  for (let part = 0; part < 2; part++) {
    if (signature[offset++] !== 0x02) return unauthorized();
    const size = signature[offset++];
    if (!size || size > 33 || offset + size > signature.length || (signature[offset] & 0x80)) return unauthorized();
    let scalar = signature.slice(offset, offset + size); offset += size;
    if (scalar[0] === 0 && scalar.length > 1) {
      if (!(scalar[1] & 0x80)) return unauthorized();
      scalar = scalar.slice(1);
    }
    if (scalar.length > 32) return unauthorized();
    result.set(scalar, part * 32 + 32 - scalar.length);
  }
  if (offset !== signature.length) return unauthorized();
  return result;
}

/** Verify the original timestamp concatenated with the untouched request bytes.
 * https://www.twilio.com/docs/sendgrid/for-developers/tracking-events/getting-started-event-webhook-security-features */
export async function verifySendgridEventSignature(raw: Uint8Array, timestamp: string | null, signature: string | null, publicKey: string | undefined, now = Date.now()): Promise<void> {
  if (!publicKey?.trim()) throw new HiringError("sendgrid_webhook_not_configured", 503, "Email event verification is not configured.");
  if (raw.byteLength > SENDGRID_EVENT_MAX_BYTES) throw new HiringError("request_too_large", 413, "This request is too large.");
  if (!timestamp || !signature || !/^[1-9]\d{8,11}$/.test(timestamp) || Math.abs(Math.floor(now / 1_000) - Number(timestamp)) > MAX_CLOCK_SKEW_SECONDS) return unauthorized();
  const encodedKey = publicKey.trim().replace(/^-----BEGIN PUBLIC KEY-----\s*/, "").replace(/\s*-----END PUBLIC KEY-----$/, "").replace(/\s/g, "");
  try {
    const keyBytes = base64(encodedKey, 2_048), signatureBytes = p1363(base64(signature, 256));
    const key = await crypto.subtle.importKey("spki", new Uint8Array(keyBytes).buffer, { name: "ECDSA", namedCurve: "P-256" }, false, ["verify"]);
    const prefix = new TextEncoder().encode(timestamp), signed = new Uint8Array(prefix.length + raw.byteLength);
    signed.set(prefix); signed.set(raw, prefix.length);
    if (!await crypto.subtle.verify({ name: "ECDSA", hash: "SHA-256" }, key, new Uint8Array(signatureBytes).buffer, signed.buffer)) return unauthorized();
  } catch { return unauthorized(); }
}

export async function receiveSendgridEvents(source: StoreSource, raw: Uint8Array, timestamp: string | null, signature: string | null, publicKey: string | undefined, now = Date.now()) {
  await verifySendgridEventSignature(raw, timestamp, signature, publicKey, now);
  let body: unknown;
  try { body = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(raw)); }
  catch { throw new HiringError("invalid_sendgrid_events", 400, "The email event payload could not be read."); }
  const parsed = z.array(eventSchema).max(MAX_EVENTS).safeParse(body);
  if (!parsed.success) throw new HiringError("invalid_sendgrid_events", 400, "The email event payload is invalid.");
  const tagged = parsed.data.filter(event => event.aicl_message && event.sg_message_id);
  if (!tagged.length) return { accepted: 0, duplicates: 0, ignored: parsed.data.length };
  const store = typeof source === "function" ? await source() : source;
  const statements: D1PreparedStatement[] = [];
  for (const event of tagged) {
    const eventHash = await sha256(event.sg_event_id), recipientHash = await sha256(event.email);
    const record: StoredSendgridEvent = { eventId: event.sg_event_id, messageId: event.sg_message_id!, email: event.email, tag: event.aicl_message!, event: event.event, timestamp: event.timestamp, receivedAt: now };
    const value = JSON.stringify(record), key = `sendgrid_event:${eventHash}`;
    statements.push(store.stmt("INSERT INTO hub_settings(key,value,updated_at) VALUES(?,?,?) ON CONFLICT(key) DO NOTHING", key, value, now));
    // A conflicting reuse of sg_event_id cannot add evidence for another recipient or tag.
    statements.push(store.stmt("INSERT INTO hub_settings(key,value,updated_at) SELECT ?,?,? WHERE EXISTS(SELECT 1 FROM hub_settings WHERE key=? AND value=?) ON CONFLICT(key) DO NOTHING", `sendgrid_mail:${record.tag}:${recipientHash}:${eventHash}`, value, now, key, value));
  }
  const results = await store.db.batch(statements);
  const accepted = results.reduce((total, result, index) => total + (index % 2 === 0 ? result.meta.changes || 0 : 0), 0);
  return { accepted, duplicates: tagged.length - accepted, ignored: parsed.data.length - tagged.length };
}

/** Actual events can append a server suffix to the API's provider ID. Preserve
 * dots in the base ID and only remove known SendGrid server suffixes. */
function providerIdentity(value: string): string { return value.replace(/\.(?:stfilter|filter|recv(?:d)?)[A-Za-z0-9_-]*\..*$/, ""); }

/** Private read-only evidence for an ambiguous send. No event can resend mail or
 * change an applicant's hiring stage. A negative lookup never proves non-delivery. */
export async function readSendgridEvidence(store: HubStore, messageId: string, to: string, sentAt?: number): Promise<Record<string, unknown> | null> {
  const email = z.string().trim().email().max(254).parse(to).toLowerCase();
  const tag = await sha256(normalizedMessageId(messageId)), recipientHash = await sha256(email);
  const rows = await store.rows<{ value: string }>("SELECT value FROM hub_settings WHERE key LIKE ? ORDER BY updated_at LIMIT 1001", `sendgrid_mail:${tag}:${recipientHash}:%`);
  if (rows.length > MAX_EVENTS) throw { code: "transactional_mail_evidence_limit", uncertain: true };
  const observed = rows.map(row => JSON.parse(row.value) as StoredSendgridEvent).filter(event => event.tag === tag && event.email === email && (!sentAt || event.timestamp * 1_000 >= sentAt - 60_000));
  if (!observed.length) return null;
  const ids = [...new Set(observed.map(event => providerIdentity(event.messageId)))];
  if (ids.length !== 1) throw { code: "transactional_mail_duplicate_evidence", uncertain: true };
  const latest = observed.sort((a, b) => b.timestamp - a.timestamp)[0];
  return { id: ids[0], provider: "sendgrid", accepted: true, delivered: observed.some(event => event.event === "delivered"), failed: observed.some(event => event.event === "bounce" || event.event === "dropped"), event: latest.event };
}

export async function handleSendgridEventWebhook(request: Request, source: StoreSource, publicKey: string | undefined, now = Date.now()): Promise<Response> {
  try {
    if (request.method !== "POST") return new Response(null, { status: 405, headers: { Allow: "POST", "Cache-Control": "no-store" } });
    const raw = await boundedBytes(request, SENDGRID_EVENT_MAX_BYTES);
    const result = await receiveSendgridEvents(source, raw, request.headers.get(SENDGRID_TIMESTAMP_HEADER), request.headers.get(SENDGRID_SIGNATURE_HEADER), publicKey, now);
    return jsonResponse({ received: true, ...result });
  } catch (error) { return errorResponse(error); }
}
