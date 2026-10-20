import type {GoogleWorkspace} from '../google/workspace';
import type {HubStore} from '../hub/store';
import {syncHiringReplies} from '../mail-sync';

const CURSOR='personal_mail_sync_cursor_v1',LEASE='personal_mail_sync_scheduler_lease_v1';
/** Visit only mailboxes that actually sent a recorded hiring thread, never unrelated staff inboxes. */
export async function syncConnectedHiringReplies(store:HubStore,db:D1Database,bucket:R2Bucket|undefined,deadline:number,resolve:(account:string)=>Promise<GoogleWorkspace|null>,sync=syncHiringReplies):Promise<number>{
 if(Date.now()>=deadline-1000)return 0;
 const token=crypto.randomUUID(),now=Date.now();
 const claim=await db.prepare("INSERT INTO hub_settings(key,value,updated_at) VALUES(?,?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value,updated_at=excluded.updated_at WHERE CAST(json_extract(hub_settings.value,'$.until') AS INTEGER)<=? RETURNING value").bind(LEASE,JSON.stringify({token,until:deadline+5000}),now,now).first();
 if(!claim)return 0;
 let imported=0,failed=false;
 try{
  const cursor=await store.setting(CURSOR,'');
  const query=`SELECT DISTINCT lower(trim(json_extract(t.payload_json,'$.deliveryAccount'))) AS account FROM hub_communications c JOIN hub_tasks t ON t.id=c.task_id WHERE c.status IN ('sent','sent_external') AND c.thread_id IS NOT NULL AND json_extract(t.payload_json,'$.deliveryProvider') IS NOT 'sendgrid' AND typeof(json_extract(t.payload_json,'$.deliveryAccount'))='text' AND length(trim(json_extract(t.payload_json,'$.deliveryAccount')))>0`;
  const after=(await db.prepare(query+" AND lower(trim(json_extract(t.payload_json,'$.deliveryAccount')))>? ORDER BY account LIMIT 3").bind(cursor).all<{account:string}>()).results;
  const accounts=after.length===3?after:[...after,...(await db.prepare(query+" AND lower(trim(json_extract(t.payload_json,'$.deliveryAccount')))<=? ORDER BY account LIMIT ?").bind(cursor,3-after.length).all<{account:string}>()).results];
  for(const {account}of accounts){
   if(Date.now()>=deadline-1000)break;
   // Advance before provider work so a broken mailbox cannot starve later recruiters.
   await store.setSetting(CURSOR,account);
   try{const workspace=await resolve(account);if(!workspace)continue;const mailboxDeadline=Math.min(deadline,Date.now()+8000);workspace.setDeadline?.(mailboxDeadline);const profile=await workspace.profile();if(profile.email.trim().toLowerCase()!==account)throw new Error('mailbox_identity_mismatch');imported+=await sync(store,db,workspace,25,mailboxDeadline,bucket);if(await store.setting(`mail_sync_last_error:${account}`,''))failed=true;}catch{failed=true;}
  }
  if(failed)await store.setSetting('mail_sync_last_error','A recruiting mailbox could not be synchronized. Check its connection; other mailboxes continue.');
  return imported;
 }finally{await db.prepare("DELETE FROM hub_settings WHERE key=? AND json_extract(value,'$.token')=?").bind(LEASE,token).run();}
}
