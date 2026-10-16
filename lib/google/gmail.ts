import type { GoogleClient } from "./client";
import { base64, base64url, emailAddress, fromBase64url, GoogleError, json, utf8 } from "./http";

const API = "https://gmail.googleapis.com/gmail/v1/users/me";
export interface MailInput { to: string; subject: string; body: string; messageId: string; replyTo?: string[]; sender?: string; candidateMail?: boolean; candidateAccount?: string }
export interface SentMail { id: string; threadId: string }
interface GmailMessage extends SentMail { internalDate?: string; labelIds?: string[]; payload?: MimePart }
interface MimePart { partId?: string; filename?: string; mimeType?: string; headers?: Array<{ name: string; value: string }>; body?: { data?: string; attachmentId?: string; size?: number }; parts?: MimePart[] }
export interface MailAttachment { partId: string; filename: string; mimeType: string; size: number; attachmentId?: string; data?: string }
export interface HiringMail { id: string; threadId: string; messageId: string; inReplyTo: string; references: string; from: string; subject: string; body: string; sent: boolean; createdAt: number; attachments: MailAttachment[]; importError?: string }
export interface MailHistoryPage { messages: SentMail[]; historyId: string; nextPageToken?: string }
const BODY_LIMIT = 200_000;
const ATTACHMENT_LIMIT = 10 * 1024 * 1024;

export function normalizedMessageId(value: string): string {
  const bare = value.startsWith("<") && value.endsWith(">") ? value.slice(1, -1) : value;
  if (bare.length > 250 || !/^[A-Za-z0-9._-]+@[A-Za-z0-9.-]+$/.test(bare) || bare.includes("..")) throw new GoogleError("invalid_message_id");
  return `<${bare}>`;
}
function subjectHeader(value: string): string {
  if (!value || value.length > 500 || /[\u0000-\u001f\u007f]/.test(value)) throw new GoogleError("invalid_mail_subject");
  // Fold encoded words without splitting UTF-8 characters, below the RFC 2047 75-character limit.
  const words: string[] = [];
  let chunk = "";
  for (const character of value) {
    if (utf8(chunk + character).length > 42) { words.push(`=?UTF-8?B?${base64(utf8(chunk))}?=`); chunk = ""; }
    chunk += character;
  }
  if (chunk) words.push(`=?UTF-8?B?${base64(utf8(chunk))}?=`);
  return words.join("\r\n ");
}
export function mimeMessage(sender: string, input: MailInput): string {
  if (typeof input.body !== "string" || utf8(input.body).length > 1_000_000) throw new GoogleError("invalid_mail_body");
  if(input.replyTo&&(!Array.isArray(input.replyTo)||input.replyTo.length>2))throw new GoogleError("invalid_reply_to");
  const encodedBody = base64(utf8(input.body.replace(/\r?\n/g, "\r\n"))).match(/.{1,76}/g)?.join("\r\n") ?? "";
  return [
    `From: ${emailAddress(sender)}`, `To: ${emailAddress(input.to)}`, ...(input.replyTo?.length?[`Reply-To: ${[...new Set(input.replyTo.map(emailAddress))].join(", ")}`]:[]), `Subject: ${subjectHeader(input.subject)}`,
    `Message-ID: ${normalizedMessageId(input.messageId)}`, `Date: ${new Date().toUTCString()}`, "MIME-Version: 1.0",
    'Content-Type: text/plain; charset="UTF-8"', "Content-Transfer-Encoding: base64", "", encodedBody, "",
  ].join("\r\n");
}
function gmailId(value: string): string {
  if (!/^[A-Za-z0-9_-]{1,128}$/.test(value)) throw new GoogleError("invalid_gmail_id");
  return value;
}
function header(part: MimePart | undefined, name: string): string {
  return part?.headers?.find((item) => item.name.toLowerCase() === name.toLowerCase())?.value ?? "";
}
function htmlText(value: string): string {
  // Stored/displayed as React text; never render provider HTML or execute remote content.
  return value.replace(/<(script|style)[^>]*>[\s\S]*?<\/\1\s*>/gi, "")
    .replace(/<(?:br|\/p|\/div|\/li|\/h[1-6])\b[^>]*>/gi, "\n").replace(/<[^>]*>/g, "")
    .replace(/&(?:nbsp|amp|lt|gt|quot|apos);/g, (entity) => ({ "&nbsp;": " ", "&amp;": "&", "&lt;": "<", "&gt;": ">", "&quot;": '"', "&apos;": "'" })[entity]!)
    .replace(/&#(x[0-9a-f]+|[0-9]+);/gi, (_entity, value: string) => { const n = value[0].toLowerCase() === "x" ? parseInt(value.slice(1), 16) : Number(value); return n > 0 && n <= 0x10ffff ? String.fromCodePoint(n) : ""; }).trim();
}
function decoded(value: string, limit: number): Uint8Array {
  if (value.length > Math.ceil(limit * 4 / 3) + 4) throw new GoogleError("gmail_part_too_large");
  const bytes = fromBase64url(value);
  if (bytes.length > limit) throw new GoogleError("gmail_part_too_large");
  return bytes;
}
function attachmentId(value: string): string {
  if (!/^[A-Za-z0-9_-]{1,2048}$/.test(value)) throw new GoogleError("invalid_gmail_attachment_id");
  return encodeURIComponent(value);
}

export class Gmail {
  private account?: { email: string; historyId?: string };
  constructor(private client: GoogleClient, private sender: string) { emailAddress(sender); }
  async profile(): Promise<{ email: string; historyId?: string }> {
    if (this.account) return this.account;
    const data = await json<{ emailAddress?: string; historyId?: string }>(await this.client.request(`${API}/profile`));
    if (!data.emailAddress) throw new GoogleError("google_profile_invalid");
    this.account = { email: emailAddress(data.emailAddress).toLowerCase(), historyId: data.historyId };
    return this.account;
  }
  /** null means not observed in Gmail search yet; it is NOT proof that an uncertain send failed. */
  async reconcile(messageId: string): Promise<SentMail | null> {
    const exact = normalizedMessageId(messageId);
    const params = new URLSearchParams({ q: `in:sent rfc822msgid:${exact}`, maxResults: "20" });
    const data = await json<{ messages?: SentMail[]; nextPageToken?: string }>(await this.client.request(`${API}/messages?${params}`));
    if (data.nextPageToken) throw new GoogleError("gmail_message_id_not_unique", 0, true);
    const matches: SentMail[] = [];
    for (const reference of data.messages ?? []) {
      const message = await json<GmailMessage>(await this.client.request(`${API}/messages/${gmailId(reference.id)}?format=metadata&metadataHeaders=Message-ID`));
      if (header(message.payload, "Message-ID").trim() === exact && message.labelIds?.includes("SENT")) {
        if (!message.id || !message.threadId) throw new GoogleError("gmail_reconciliation_invalid");
        matches.push({ id: message.id, threadId: message.threadId });
      }
    }
    if (matches.length > 1) throw new GoogleError("gmail_duplicate_message_id", 0, true);
    return matches[0] ?? null;
  }
  async send(input: MailInput): Promise<SentMail> {
    // Validate the complete envelope before any external request.
    const sender = emailAddress(input.sender || this.sender).toLowerCase();
    const raw = base64url(utf8(mimeMessage(sender, input)));
    await this.verifySender(sender, input.candidateMail ? input.candidateAccount?.trim().toLowerCase() || process.env.CANDIDATE_MAIL_ACCOUNT?.trim().toLowerCase() : undefined, !!input.candidateMail);
    const present = await this.reconcile(input.messageId);
    if (present) return present;
    const response = await this.client.request(`${API}/messages/send`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ raw }) }, true);
    const data = await json<Partial<SentMail>>(response, true);
    if (!data.id || !data.threadId) throw new GoogleError("gmail_send_response_invalid", response.status, true);
    return { id: data.id, threadId: data.threadId };
  }
  /** Read-only provider check. A stored OAuth grant alone does not verify its identity or an alias. */
  async verifySender(sender: string, candidateAccount?: string, candidateMail = true): Promise<{ account: string; sender: string; verified: true }> {
    sender = emailAddress(sender).toLowerCase();
    const profile = await this.profile();
    if (candidateMail) {
      const required = candidateAccount?.trim().toLowerCase();
      if (!required || required === "sales@aicaseleads.com") throw new GoogleError("candidate_mail_account_not_configured");
      if (profile.email !== emailAddress(required)) throw new GoogleError("candidate_mail_account_connection_required");
    }
    if (profile.email !== sender) {
      // Read the provider-approved identities on every send: revoked aliases must fail closed.
      const identities = await json<{ sendAs?: Array<{ sendAsEmail: string; verificationStatus?: string }> }>(await this.client.request(`${API}/settings/sendAs`));
      if (!identities.sendAs?.some(identity => identity.sendAsEmail.toLowerCase() === sender && identity.verificationStatus === "accepted")) throw new GoogleError("gmail_sender_alias_not_verified");
    }
    return { account: profile.email, sender, verified: true };
  }
  async attachmentBytes(messageId: string, part: MailAttachment, limit = ATTACHMENT_LIMIT): Promise<Uint8Array> {
    if (!Number.isSafeInteger(part.size) || part.size < 0 || part.size > limit) throw new GoogleError("gmail_attachment_too_large");
    const data = part.data !== undefined ? part.data : (await json<{ data?: string }>(await this.client.request(`${API}/messages/${gmailId(messageId)}/attachments/${attachmentId(part.attachmentId || "")}`), false, Math.ceil(limit * 4 / 3) + 1024)).data;
    if (typeof data !== "string") throw new GoogleError("gmail_attachment_content_missing");
    const bytes = decoded(data, limit);
    if (part.size !== bytes.length) throw new GoogleError("gmail_attachment_size_mismatch");
    return bytes;
  }
  private async parse(message: GmailMessage): Promise<HiringMail> {
    const plain: string[] = [], html: string[] = [], attachments: MailAttachment[] = [];
    let nodes = 0, bodyBytes = 0, importError: string | undefined;
    const walk = async (part: MimePart | undefined, path: string, depth: number): Promise<void> => {
      if (!part) return;
      if (++nodes > 100 || depth > 12) { importError = "gmail_mime_structure_too_large"; return; }
      const descriptor: MailAttachment = { partId: part.partId || path, filename: part.filename || "", mimeType: part.mimeType || "application/octet-stream", size: part.body?.size ?? (part.body?.data ? Math.floor(part.body.data.length * 3 / 4) : 0), attachmentId: part.body?.attachmentId, data: part.body?.data };
      if (part.filename) {
        if (attachments.length >= 20) { importError = "gmail_too_many_attachments"; return; }
        // Gmail supplies exact size; synthetic inline payloads may omit it.
        if (part.body?.size === undefined && part.body?.data) {
          try { descriptor.size = decoded(part.body.data, ATTACHMENT_LIMIT).length; }
          catch (error) { importError = error instanceof GoogleError ? error.code : "gmail_attachment_import_failed"; }
        }
        attachments.push(descriptor); return;
      }
      if (["text/plain", "text/html"].includes(part.mimeType || "") && (part.body?.data !== undefined || part.body?.attachmentId)) {
        try {
          let bytes: Uint8Array;
          if (part.body?.attachmentId) bytes = await this.attachmentBytes(message.id, descriptor, BODY_LIMIT);
          else bytes = decoded(part.body!.data!, BODY_LIMIT);
          bodyBytes += bytes.length;
          if (bodyBytes > BODY_LIMIT) throw new GoogleError("gmail_reply_too_large");
          const charset = /charset=["']?([^;"'\s]+)/i.exec(header(part, "Content-Type"))?.[1] || "utf-8";
          const text = new TextDecoder(charset).decode(bytes);
          (part.mimeType === "text/plain" ? plain : html).push(text); return;
        } catch (error) { importError = error instanceof GoogleError ? error.code : "gmail_body_import_failed"; }
      }
      for (let index = 0; index < (part.parts?.length || 0); index++) {
        if(nodes>=100){importError="gmail_mime_structure_too_large";break;}
        await walk(part.parts![index], `${path}.${index}`, depth + 1);
      }
    };
    await walk(message.payload, "0", 0);
    const plainText=plain.join("\n");
    return { id: message.id, threadId: message.threadId, messageId: header(message.payload, "Message-ID"), inReplyTo: header(message.payload, "In-Reply-To"), references: header(message.payload, "References"), from: header(message.payload, "From"), subject: header(message.payload, "Subject"), body: plainText.trim() ? plainText : html.map(htmlText).join("\n"), sent: !!message.labelIds?.includes("SENT"), createdAt: Number(message.internalDate) || 0, attachments, importError };
  }
  async message(id: string): Promise<HiringMail> {
    const message = await json<GmailMessage>(await this.client.request(`${API}/messages/${gmailId(id)}?format=full`));
    if (message.id !== id || !message.threadId) throw new GoogleError("gmail_message_identity_mismatch");
    return this.parse(message);
  }
  async history(startHistoryId: string, pageToken?: string): Promise<MailHistoryPage> {
    if (!/^[0-9]{1,40}$/.test(startHistoryId) || (pageToken && pageToken.length > 2048)) throw new GoogleError("gmail_history_cursor_invalid");
    const params = new URLSearchParams({ startHistoryId, maxResults: "50", historyTypes: "messageAdded", ...(pageToken ? { pageToken } : {}) });
    const data = await json<{ history?: Array<{ messagesAdded?: Array<{ message: SentMail }> }>; historyId?: string; nextPageToken?: string }>(await this.client.request(`${API}/history?${params}`));
    if (!data.historyId || !/^[0-9]{1,40}$/.test(data.historyId)) throw new GoogleError("gmail_history_response_invalid");
    const messages = [...new Map((data.history || []).flatMap((item) => (item.messagesAdded || []).map(({ message }) => [message.id, message] as const))).values()];
    if (messages.length > 1000 || messages.some((message) => !message.id || !message.threadId)) throw new GoogleError("gmail_history_page_invalid");
    return { messages, historyId: data.historyId, nextPageToken: data.nextPageToken };
  }
  /** Used for bounded first-run/expired-cursor repair, never as the steady-state polling algorithm. */
  async threadMessages(threadId: string): Promise<HiringMail[]> {
    const data = await json<{ messages?: GmailMessage[] }>(await this.client.request(`${API}/threads/${gmailId(threadId)}?format=full`));
    if ((data.messages?.length ?? 0) > 200) throw new GoogleError("gmail_thread_too_large");
    const result: HiringMail[] = [];
    for (const message of data.messages || []) result.push(await this.parse(message));
    return result;
  }
}
