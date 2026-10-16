import type { HubStore } from './store';
import type { HubMember } from './auth';
import { HiringError } from '../hiring/errors';
import type { Stage } from './types';

export const applicationTrashKey = (id:string) => `application_trash:${id}`;
export const activeApplicationsSql = (alias:string) => `NOT EXISTS (SELECT 1 FROM hub_settings application_trash WHERE application_trash.key='application_trash:'||${alias}.id)`;
export type ApplicationTrash = { previousStage:Stage; deletedAt:number; actor:string };
export async function applicationTrash(store:HubStore,id:string):Promise<ApplicationTrash|null> {
  return store.setting<ApplicationTrash|null>(applicationTrashKey(id),null);
}
/** Reversible removal from recruiting queues. Original files and hiring history remain intact. */
export async function changeApplicationTrash(store:HubStore,id:string,action:'trash'|'restore',expectedRevision:number,member:HubMember) {
  const app=await store.getApplication(id), current=await applicationTrash(store,id);
  if(!Number.isSafeInteger(expectedRevision)||expectedRevision!==app.revision) throw new HiringError('application_changed',409,'This application changed. Refresh it before trying again.');
  if(action==='trash'&&current) return app;
  if(action==='restore'&&!current) return app;
  const activeInterview=await store.stmt("SELECT id FROM hub_interviews WHERE application_id=? AND status IN ('pending','booked','cancel_pending','failed') LIMIT 1",id).first();
  if(action==='trash'&&activeInterview) throw new HiringError('cancel_interview_first',409,'Cancel this applicant’s interview or resolve its failed Calendar update before moving the application to Trash.');
  const now=Date.now(), nextStage=action==='trash'?'Withdrawn':current!.previousStage;
  const statements=[store.stmt("UPDATE hub_applications SET id=CASE WHEN revision=? AND NOT EXISTS(SELECT 1 FROM hub_tasks t WHERE t.application_id=hub_applications.id AND t.kind IN ('gmail','calendar') AND t.status='running') AND NOT EXISTS(SELECT 1 FROM hub_interviews i WHERE i.application_id=hub_applications.id AND i.status IN ('pending','booked','cancel_pending','failed')) THEN id ELSE NULL END,stage=?,stage_entered_at=?,revision=revision+1,updated_at=? WHERE id=?",expectedRevision,nextStage,now,now,id)];
  if(action==='trash') statements.push(
    store.stmt('INSERT INTO hub_settings(key,value,updated_at) VALUES(?,?,?)',applicationTrashKey(id),JSON.stringify({previousStage:app.stage,deletedAt:now,actor:member.email}),now),
    store.stmt("UPDATE hub_links SET used_at=? WHERE application_id=? AND used_at IS NULL",now,id),
    store.stmt("UPDATE hub_interviews SET status='cancelled',revision=revision+1,updated_at=? WHERE application_id=? AND status='invited'",now,id),
    store.stmt("UPDATE hub_tasks SET status='done',result_json=?,last_error=NULL,lease_token=NULL,lease_until=NULL,updated_at=? WHERE application_id=? AND kind='gmail' AND status IN ('pending','failed')",JSON.stringify({cancelled:true,applicationTrashed:true}),now,id),
    store.stmt("UPDATE hub_communications SET status='cancelled',updated_at=? WHERE application_id=? AND status IN ('queued','pending','failed')",now,id),
  );
  else statements.push(store.stmt('DELETE FROM hub_settings WHERE key=?',applicationTrashKey(id)));
  statements.push(store.stmt("INSERT INTO hub_history(id,application_id,type,text,actor,from_stage,to_stage,created_at) VALUES(?,?,?,?,?,?,?,?)",crypto.randomUUID(),id,action,action==='trash'?'Moved application to Trash. Files retained; unsent emails and booking links cancelled.':'Restored application from Trash. Cancelled emails and booking links remain cancelled.',member.email,app.stage,nextStage,now));
  try {await store.db.batch(statements);} catch(error) {
    if(/NOT NULL|constraint/i.test(String(error)))throw new HiringError('application_changed',409,'The application changed or delivery is in progress. Refresh and try again.');
    throw error;
  }
  return store.getApplication(id);
}
