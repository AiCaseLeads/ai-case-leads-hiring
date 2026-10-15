import { jobNotificationStatements } from "./job-team/service";
import type { GoogleWorkspace } from "./google/workspace";
import type { HiringMail, MailAttachment } from "./google/gmail";
import { GoogleError, hash } from "./google/http";
import { HubStore } from "./hub/store";
import { withinDeadline } from "./hiring/deadline";
import { documentStructure } from "./hiring/document-structure";

type ThreadLink = { thread_id: string; application_id: string; email: string; payload_json: string; provider_id: string | null };
type MessageRef = { id: string; threadId: string };
type ImportedFile = { existing: boolean; id: string; quarantined: boolean; name?: string; contentType?: string; objectKey?: string; size?: number; partId?: string };
type SyncState = { mailbox: string; historyId: string; pageToken?: string; pending?: MessageRef[]; nextPageToken?: string; targetHistoryId?: string; bootstrapAfter?: string; bootstrapDone?: boolean; catchupEpoch?: string };
const STATE = "gmail_delta_state_v1", LEASE = "gmail_sync_lease";
function address(value: string) { return (value.match(/<([^<>]+)>/)?.[1] || value).trim().toLowerCase(); }
function messageIds(value: string) { return new Set(value.match(/<[^<>\s]+>/g) || []); }
async function links(db: D1Database, thread: string, mailbox:string): Promise<ThreadLink[]> {
  return (await db.prepare("SELECT c.thread_id,c.application_id,a.email,t.payload_json,c.provider_id FROM hub_communications c JOIN hub_applications a ON a.id=c.application_id JOIN hub_tasks t ON t.id=c.task_id WHERE c.thread_id=? AND json_extract(t.payload_json,'$.deliveryAccount')=? AND c.status IN ('sent','sent_external')").bind(thread,mailbox).all<ThreadLink>()).results;
}
function filename(value: string) { return value.replace(/[\x00-\x1f\x7f/\\]/g, "_").trim().slice(0, 135) || "attachment"; }
async function attachmentFile(db: D1Database, bucket: R2Bucket | undefined, google: GoogleWorkspace, appId: string, message: HiringMail, part: MailAttachment, deadline: number, mailbox:string): Promise<ImportedFile> {
  if (!bucket) throw new GoogleError("mail_attachment_storage_unavailable");
  if (!Number.isSafeInteger(part.size) || part.size < 1 || part.size > 10 * 1024 * 1024) throw new GoogleError("gmail_attachment_too_large");
  const id = `gmail-${await hash(`${mailbox}:${appId}:${message.id}:${part.partId}`)}`;
  const existing = await db.prepare("SELECT application_id,filename,content_type,size,object_key FROM hub_files WHERE id=? AND uploaded_at>0").bind(id).first<{ application_id: string; filename: string; content_type: string; size: number; object_key: string }>();
  if (existing) {
    if (existing.application_id !== appId || existing.size !== part.size) throw new GoogleError("mail_attachment_identity_mismatch");
    return { existing: true, id, quarantined: existing.filename.endsWith(".quarantined") };
  }
  const bytes = await google.mailAttachment(message.id, part);
  let quarantined = false;
  const supported = new Set(["application/pdf", "application/msword", "application/vnd.openxmlformats-officedocument.wordprocessingml.document", "image/png", "image/jpeg", "image/webp", "text/plain"]);
  if (!supported.has(part.mimeType)) quarantined = true;
  else if (["application/pdf", "application/msword", "application/vnd.openxmlformats-officedocument.wordprocessingml.document"].includes(part.mimeType)) {
    quarantined = !documentStructure(bytes, part.mimeType);
  }
  const name = filename(part.filename) + (quarantined ? ".quarantined" : ""), contentType = quarantined ? "application/octet-stream" : part.mimeType;
  const objectKey = `hiring/mail${quarantined ? "-quarantine" : ""}/${appId}/${id}`;
  await withinDeadline(()=>bucket.put(objectKey, bytes, { httpMetadata: { contentType }, customMetadata: { fileId: id, messageId: message.id, partId: part.partId, originalFilename: filename(part.filename), quarantine: String(quarantined) } }),deadline,"storage_deadline_exceeded");
  return { existing: false, id, quarantined, name, contentType, objectKey, size: bytes.length, partId: part.partId };
}
async function importMessage(store: HubStore, db: D1Database, google: GoogleWorkspace, message: HiringMail, linked: ThreadLink[], bucket: R2Bucket | undefined, deadline: number, mailbox:string): Promise<number> {
  if (linked.some(link => link.provider_id === message.id)) return 0;
  const parent = messageIds(message.inReplyTo), ancestors = messageIds(message.references);
  const matches = (ids: Set<string>) => linked.filter(link => ids.has(String((JSON.parse(link.payload_json) as { messageId?: string }).messageId || "")));
  let matching = matches(parent);
  if (!matching.length) matching = matches(ancestors);
  if (!matching.length && new Set(linked.map(link => link.application_id)).size === 1) matching = linked;
  const ids = [...new Set(matching.map(link => link.application_id))];
  if (ids.length !== 1 || (!message.sent && !matching.some(link => address(message.from) === link.email.toLowerCase()))) return 0;
  const appId = ids[0], taskId = `gmail-import:${mailbox}:${message.id}`, now = Date.now();
  if (await store.setting(`gmail_message_complete:${mailbox}:${message.id}`, 0) === 1) return 0;
  const existing = await db.prepare("SELECT body FROM hub_communications WHERE task_id=?").bind(taskId).first<{ body: string }>();
  const app = await db.prepare("SELECT job_id,session_hash FROM hub_applications WHERE id=?").bind(appId).first<{ job_id: string; session_hash: string }>();
  if (!app) return 0;
  let error = message.importError || "";
  const files: Awaited<ReturnType<typeof attachmentFile>>[] = [];
  for (const part of message.attachments || []) {
    try { files.push(await attachmentFile(db, bucket, google, appId, message, part, deadline,mailbox)); }
    catch (failure) { error = failure instanceof GoogleError ? failure.code : "mail_attachment_import_failed"; }
  }
  let body = message.body.replace(/https?:\/\/[^\s<>]+\/(assessment|interview)\/[a-f0-9]{64}/g, "[private candidate link]");
  if (files.some(file => file.quarantined)) body += "\n[Attachment retained in quarantine. Review before opening.]";
  if (error) body += "\n[Email import incomplete. Original content remains in Gmail; the hub will retry.]";
  const added = files.filter(file => !file.existing), changed = !existing || existing.body !== body || added.length > 0;
  const statements = [
    ...(changed ? [db.prepare("UPDATE hub_applications SET revision=revision+1,updated_at=? WHERE id=?").bind(now, appId)] : []),
    db.prepare("INSERT INTO hub_tasks (id,application_id,kind,payload_json,status,attempts,run_after,created_at,updated_at) VALUES (?,?,'gmail',?,'done',0,?,?,?) ON CONFLICT(id) DO NOTHING").bind(taskId, appId, JSON.stringify({ deliveryAccount:mailbox,messageId: message.messageId, direction: message.sent ? "outbound" : "inbound" }), now, message.createdAt || now, now),
    db.prepare("INSERT INTO hub_communications (id,application_id,task_id,subject,body,status,provider_id,thread_id,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?) ON CONFLICT(task_id) DO UPDATE SET body=excluded.body,subject=excluded.subject,updated_at=CASE WHEN hub_communications.body<>excluded.body THEN excluded.updated_at ELSE hub_communications.updated_at END").bind(`communication:${taskId}`, appId, taskId, message.subject, body, message.sent ? "sent_external" : "received", message.id, message.threadId, message.createdAt || now, now),
  ];
  for (const file of added) statements.push(db.prepare("INSERT INTO hub_files(id,job_id,field_path,filename,content_type,size,object_key,uploaded_at,application_id,expires_at,session_hash) VALUES(?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO NOTHING").bind(file.id, app.job_id, `gmail:${message.id}:${file.partId}`, file.name!, file.contentType!, file.size!, file.objectKey!, now, appId, Number.MAX_SAFE_INTEGER, app.session_hash));
  if (changed) statements.push(db.prepare("INSERT INTO hub_tasks (id,application_id,kind,payload_json,status,attempts,run_after,created_at,updated_at) SELECT 'drive:'||id||':mail:'||?,id,'drive',?,'pending',0,?,?,? FROM hub_applications WHERE id=? ON CONFLICT(id) DO NOTHING").bind(`${mailbox}:${message.id}:${await hash(body + added.map(file => file.id).join())}`, JSON.stringify({ applicationId: appId }), now, now, now, appId));
  statements.push(store.settingStatement(`gmail_message_complete:${mailbox}:${message.id}`, error ? 0 : 1), store.settingStatement(`gmail_message_error:${mailbox}:${message.id}`, error), store.settingStatement(`gmail_message_next_repair:${mailbox}:${message.id}`, error ? now + 15 * 60_000 : 0));
  if(!message.sent&&!existing)statements.push(...await jobNotificationStatements(store,app.job_id,appId,"reply",`${mailbox}:${message.id}`,now,message.createdAt||now));
  await db.batch(statements);
  return changed ? 1 : 0;
}

export async function syncHiringReplies(store: HubStore, db: D1Database, google: GoogleWorkspace, max = 50, deadline = Date.now() + 20_000, bucket?: R2Bucket): Promise<number> {
  const token = crypto.randomUUID(), now = Date.now();
  const claim = await db.prepare("INSERT INTO hub_settings(key,value,updated_at) VALUES(?,?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value,updated_at=excluded.updated_at WHERE CAST(json_extract(hub_settings.value,'$.until') AS INTEGER)<=? RETURNING value").bind(LEASE, JSON.stringify({ token, until: Math.max(now + 30_000, deadline + 5000) }), now, now).first();
  if (!claim) return 0;
  let imported = 0;
  try {
    const known = await db.prepare("SELECT 1 AS present FROM hub_communications WHERE status IN ('sent','sent_external') AND thread_id IS NOT NULL LIMIT 1").first();
    if(!known){await store.setSetting("mail_sync_last_checked_at",Date.now());await store.setSetting("mail_sync_last_error","");return 0;}
    const profile = await google.profile();
    const scopedKnown=await db.prepare("SELECT 1 AS present FROM hub_communications c JOIN hub_tasks t ON t.id=c.task_id WHERE c.status IN ('sent','sent_external') AND c.thread_id IS NOT NULL AND json_extract(t.payload_json,'$.deliveryAccount')=? LIMIT 1").bind(profile.email).first();
    if(!scopedKnown){await store.setSetting("mail_sync_last_checked_at",Date.now());await store.setSetting("mail_sync_last_error","");return 0;}
    if (!profile.historyId || !/^[0-9]{1,40}$/.test(profile.historyId)) throw new GoogleError("gmail_history_unavailable");
    let state = await store.setting<SyncState | null>(STATE, null);
    if (!state || state.mailbox !== profile.email) { state = { mailbox: profile.email, historyId: profile.historyId, catchupEpoch: crypto.randomUUID() }; await store.setSetting(STATE, state); }
    // Finish a durably saved page before fetching another. The cursor cannot skip a partial page.
    if (!state.pending && Date.now() < deadline - 1000) {
      try {
        const page = await google.mailHistory(state.historyId, state.pageToken);
        state.pending = page.messages; state.nextPageToken = page.nextPageToken; state.targetHistoryId = page.historyId;
        await store.setSetting(STATE, state);
      } catch (error) {
        if (!(error instanceof GoogleError && error.status === 404)) throw error;
        state = { mailbox: profile.email, historyId: profile.historyId, catchupEpoch: crypto.randomUUID() };
        await store.setSetting(STATE, state);
      }
    }
    for (let count = 0; state.pending?.length && count < Math.max(1, Math.min(max, 100)) && Date.now() < deadline - 1000; count++) {
      const reference = state.pending[0], linked = await links(db, reference.threadId,profile.email);
      if (linked.length && !linked.some(link => link.provider_id === reference.id) && await store.setting(`gmail_message_complete:${profile.email}:${reference.id}`,0)!==1 && !await store.setting(`gmail_message_missing:${profile.email}:${reference.id}`,null)) {
        let message: HiringMail | null;
        try { message = await google.mailMessage(reference.id); }
        catch (error) {
          // Gmail history can refer to a message that was permanently deleted before
          // this read. Save that observation before checkpointing past it; all other
          // read failures retain the pending reference for retry.
          if (!(error instanceof GoogleError && error.status === 404)) throw error;
          await store.setSetting(`gmail_message_missing:${profile.email}:${reference.id}`, { threadId: reference.threadId, applicationIds: [...new Set(linked.map(link => link.application_id))], observedAt: Date.now() });
          message = null;
        }
        if (message) imported += await importMessage(store, db, google, message, linked, bucket, deadline,profile.email);
      }
      state.pending.shift(); await store.setSetting(STATE, state);
    }
    if (state.pending && !state.pending.length) {
      if (state.nextPageToken) state.pageToken = state.nextPageToken;
      else { state.historyId = state.targetHistoryId!; delete state.pageToken; }
      delete state.pending; delete state.nextPageToken; delete state.targetHistoryId;
      await store.setSetting(STATE, state); await store.setSetting("mail_sync_last_checked_at", Date.now());
    }
    // Every newly linked thread receives one durable catch-up, even if its delta arrived
    // while delivery was uncertain. A cursor-expiry recovery starts a fresh catch-up epoch.
    if(!state.catchupEpoch){state.catchupEpoch=crypto.randomUUID();await store.setSetting(STATE,state);}
    if(Date.now()<deadline-2000){
      const prefix=`gmail_thread_caught_up:${profile.email}:${state.catchupEpoch}:`;
      const groups=(await db.prepare("SELECT c.thread_id FROM hub_communications c JOIN hub_tasks t ON t.id=c.task_id LEFT JOIN hub_settings complete ON complete.key=?||c.thread_id LEFT JOIN hub_settings next ON next.key=?||c.thread_id WHERE json_extract(t.payload_json,'$.deliveryAccount')=? AND c.status IN ('sent','sent_external') AND c.thread_id IS NOT NULL AND complete.key IS NULL AND COALESCE(CAST(next.value AS INTEGER),0)<=? GROUP BY c.thread_id ORDER BY MAX(c.created_at) DESC,c.thread_id LIMIT 2").bind(prefix,`gmail_thread_next_poll:${profile.email}:`,profile.email,Date.now()).all<{thread_id:string}>()).results;
      for(const group of groups){
        if(Date.now()>=deadline-1000)break;
        try{
          const linked=await links(db,group.thread_id,profile.email),messages=await google.threadMessages(group.thread_id);let complete=true;
          for(const message of messages){if(Date.now()>=deadline-1000){complete=false;break;}imported+=await importMessage(store,db,google,message,linked,bucket,deadline,profile.email);}
          if(!complete)throw new GoogleError("mail_catchup_checkpoint_pending");
          await store.setSetting(prefix+group.thread_id,true);await store.setSetting(`gmail_thread_error:${profile.email}:${group.thread_id}`,"");
        }catch{await store.setSetting(`gmail_thread_error:${profile.email}:${group.thread_id}`,"Google could not read this hiring thread. Check mailbox access or reconnect Workspace.");await store.setSetting(`gmail_thread_next_poll:${profile.email}:${group.thread_id}`,Date.now()+15*60_000);}
      }
    }
    // Repair old blank imports and temporary partial imports without replaying decisions or email sends.
    const repairs = (await db.prepare("SELECT c.provider_id,c.thread_id FROM hub_communications c JOIN hub_tasks t ON t.id=c.task_id LEFT JOIN hub_settings done ON done.key=?||c.provider_id LEFT JOIN hub_settings next ON next.key=?||c.provider_id WHERE json_extract(t.payload_json,'$.deliveryAccount')=? AND c.status IN ('received','sent_external') AND c.provider_id IS NOT NULL AND COALESCE(CAST(done.value AS INTEGER),0)<>1 AND COALESCE(CAST(next.value AS INTEGER),0)<=? ORDER BY c.created_at LIMIT 2").bind(`gmail_message_complete:${profile.email}:`,`gmail_message_next_repair:${profile.email}:`,profile.email,Date.now()).all<{ provider_id: string; thread_id: string }>()).results;
    for (const repair of repairs) {
      if (Date.now() >= deadline - 1000) break;
      try { imported += await importMessage(store, db, google, await google.mailMessage(repair.provider_id), await links(db, repair.thread_id,profile.email), bucket, deadline,profile.email); }
      catch { await store.setSetting(`gmail_message_error:${profile.email}:${repair.provider_id}`, "gmail_message_repair_pending"); await store.setSetting(`gmail_message_next_repair:${profile.email}:${repair.provider_id}`, Date.now() + 15 * 60_000); }
    }
    const errors = await db.prepare("SELECT COUNT(*) AS n FROM hub_settings WHERE (key LIKE ? OR key LIKE ?) AND value<>'\"\"'").bind(`gmail_message_error:${profile.email}:%`,`gmail_thread_error:${profile.email}:%`).first<{ n: number }>();
    await store.setSetting("mail_sync_last_error", errors?.n ? `${errors.n} hiring email import(s) need repair. Other threads continue syncing; original content remains in Gmail.` : "");
    return imported;
  } catch {
    await store.setSetting("mail_sync_last_error", "Mailbox synchronization needs attention. Reconnect Google or inspect the integration queue; its saved cursor will resume.");
    return imported;
  } finally {
    await db.prepare("DELETE FROM hub_settings WHERE key=? AND json_extract(value,'$.token')=?").bind(LEASE, token).run();
  }
}
