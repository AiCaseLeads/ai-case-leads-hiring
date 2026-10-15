import { z } from 'zod';
import { HiringError } from '../hiring/errors';
import { sha256,canonicalJson } from '../hiring/crypto';
import { hourlyRateWindow } from '../hiring/rate-window';
import type { HubStore } from '../hub/store';
export const helpInput = z.object({id:z.string().uuid(),email:z.string().trim().email().max(254),job:z.string().trim().max(200),kind:z.enum(['application','correction','withdrawal','removal','privacy']),message:z.string().trim().min(10).max(4000),token:z.string().max(2048)}).strict();
export type HelpRecord = {id:string;email:string;job:string;kind:string;message:string;status:'open'|'resolved';createdAt:number;updatedAt:number;resolvedBy?:string};
const prefix='recruiting_help:';
async function identity(input:z.infer<typeof helpInput>,session:string){return {key:prefix+await sha256(session+':'+input.id),fingerprint:await sha256(canonicalJson({email:input.email.toLowerCase(),job:input.job,kind:input.kind,message:input.message}))};}
export async function existingHelp(store:HubStore,input:z.infer<typeof helpInput>,session:string){
 const {key,fingerprint}=await identity(input,session);const existing=await store.stmt('SELECT fingerprint FROM hub_recruiting_help WHERE id=?',key).first<{fingerprint:string}>();
 if(existing&&existing.fingerprint!==fingerprint)throw new HiringError('request_conflict',409,'This request was already saved with different details. Reload the form to start a new request.');
 return !!existing;
}
export async function limitHelpVerification(store:HubStore,session:string,ip?:string|null){
 for(const [identity,max] of [['global',300],[`session:${session}`,20],...(ip?[[`ip:${ip}`,60] as const]:[])] as const){
  const accepted=await store.stmt('INSERT INTO hiring_rate_limits(key_hash,window,attempts) VALUES(?,?,1) ON CONFLICT(key_hash,window) DO UPDATE SET attempts=attempts+1 WHERE attempts<? RETURNING attempts',await sha256('recruiting-help-verification:'+identity),hourlyRateWindow(),max).first();
  if(!accepted)throw new HiringError('rate_limited',429,'Too many verification attempts. Please try again later.');
 }
}
export async function saveHelp(store:HubStore,input:z.infer<typeof helpInput>,session:string,ip?:string|null){
 const {key,fingerprint}=await identity(input,session);
 if(await existingHelp(store,input,session))return {id:input.id};
 for(const [identity,max] of [['global',100],[`session:${session}`,5],[`email:${input.email.toLowerCase()}`,5],...(ip?[[`ip:${ip}`,30] as const]:[])] as const){
  const accepted=await store.stmt('INSERT INTO hiring_rate_limits(key_hash,window,attempts) VALUES(?,?,1) ON CONFLICT(key_hash,window) DO UPDATE SET attempts=attempts+1 WHERE attempts<? RETURNING attempts',await sha256('recruiting-help:'+identity),hourlyRateWindow(),max).first();
  if(!accepted)throw new HiringError('rate_limited',429,'Too many help requests. Please try again later.');
 }
 const now=Date.now();
 await store.stmt("INSERT INTO hub_recruiting_help(id,request_id,fingerprint,email,job,kind,message,status,created_at,updated_at) VALUES(?,?,?,?,?,?,?,'open',?,?) ON CONFLICT(id) DO NOTHING",key,input.id,fingerprint,input.email.toLowerCase(),input.job,input.kind,input.message,now,now).run();
 await existingHelp(store,input,session);
 return {id:input.id};
}
export async function listHelp(store:HubStore,page=1){
 await store.stmt("DELETE FROM hub_recruiting_help WHERE id IN (SELECT id FROM hub_recruiting_help WHERE status='resolved' AND updated_at<? LIMIT 100)",Date.now()-90*86400000).run();
 const offset=(page-1)*25;
 const rows=await store.rows<HelpRecord&{key:string}>("SELECT id AS key,request_id AS id,email,job,kind,message,status,created_at AS createdAt,updated_at AS updatedAt,resolved_by AS resolvedBy FROM hub_recruiting_help ORDER BY status ASC,created_at DESC LIMIT 26 OFFSET ?",offset);
 return {items:rows.slice(0,25),hasMore:rows.length>25};
}
export async function resolveHelp(store:HubStore,key:string,status:'open'|'resolved',staff:string){
 if(!/^recruiting_help:[a-f0-9]{64}$/.test(key))throw new HiringError('invalid_request',400,'Invalid request.');
 const now=Date.now();
 const result=await store.stmt("UPDATE hub_recruiting_help SET status=?,updated_at=?,resolved_by=? WHERE id=? RETURNING id",status,now,staff,key).first();
 if(!result)throw new HiringError('not_found',404,'This request was not found.');
}
