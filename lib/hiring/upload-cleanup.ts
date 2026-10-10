import { withinDeadline } from "./deadline";
/** Reclaim expired, unattached uploads only. Claim first so an acceptance cannot attach a deleted object. */
export async function cleanupExpiredUploads(db:D1Database,bucket:R2Bucket|undefined,deadline=Date.now()+5000,max=10){
 if(!bucket?.delete)return {deleted:0,failed:0};
 const now=Date.now(),cutoff=now-3600000;
 const result=await db.prepare("SELECT f.id FROM hub_files f LEFT JOIN hub_settings retry ON retry.key='upload_cleanup_retry:'||f.id WHERE f.application_id IS NULL AND f.expires_at<=? AND COALESCE(CAST(retry.value AS INTEGER),0)<=? ORDER BY f.expires_at,f.id LIMIT ?").bind(cutoff,now,Math.max(1,Math.min(max,20))).all<{id:string}>();
 let deleted=0,failed=0;
 for(const item of result.results){
  if(Date.now()>=deadline-500)break;
  const claimed=await db.prepare("UPDATE hub_files SET uploaded_at=-2 WHERE id=? AND application_id IS NULL AND expires_at<=? RETURNING object_key").bind(item.id,cutoff).first<{object_key:string}>();
  if(!claimed)continue;
  try{
   await withinDeadline(()=>bucket.delete(claimed.object_key),Math.min(deadline,Date.now()+5000),"storage_deadline_exceeded");
   await db.batch([
    db.prepare("DELETE FROM hub_files WHERE id=? AND application_id IS NULL AND uploaded_at=-2").bind(item.id),
    db.prepare("DELETE FROM hub_settings WHERE key=?").bind("upload_cleanup_retry:"+item.id),
   ]);
   deleted++;
  }catch{
   failed++;
   // Skip temporarily failing objects so they cannot starve later healthy uploads.
   await db.prepare("INSERT INTO hub_settings(key,value,updated_at) VALUES (?,?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value,updated_at=excluded.updated_at").bind("upload_cleanup_retry:"+item.id,String(Date.now()+15*60000),Date.now()).run();
  }
 }
 // These limits and OAuth states cannot be used again. Preserve receipt/submission recovery records.
 await db.prepare("DELETE FROM hiring_rate_limits WHERE window<?").bind(Math.floor(now/600000)-144).run();
 await db.prepare("DELETE FROM hub_oauth_states WHERE expires_at<?").bind(now-86400000).run();
 return {deleted,failed};
}
