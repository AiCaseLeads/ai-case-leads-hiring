import { privateToken, sha256 } from '../hiring/crypto';
import { HiringError } from '../hiring/errors';
import type { HubStore } from '../hub/store';
export type AgentScope='jobs:draft'|'jobs:publish'|'jobs:read'|'applicants:read'|'files:read';
type Access={id:string;hash:string;name:string;scopes:AgentScope[];createdBy:string;expiresAt:number;revoked:boolean};
export async function issueAccess(store:HubStore,name:string,scopes:AgentScope[],actor:string){
 const id=crypto.randomUUID(),secret=privateToken(),token=`hiring_${id}_${secret}`;
 const record:Access={id,hash:await sha256(token),name:name.slice(0,100),scopes:validateAccessScopes(scopes),createdBy:actor,expiresAt:Date.now()+90*86400000,revoked:false};
 await store.setSetting('agent_access_'+id,record);return {...record,hash:undefined,token};
}
export async function authorizeAgent(store:HubStore,request:Request,scope:AgentScope){
 const token=request.headers.get('authorization')?.match(/^Bearer (hiring_([a-f0-9-]{36})_[a-f0-9]{64})$/);if(!token)throw new HiringError('agent_unauthorized',401,'A valid scoped agent token is required.');
 const record=await store.setting<Access|null>('agent_access_'+token[2],null);
 if(!record||record.revoked||record.expiresAt<=Date.now()||record.hash!==await sha256(token[1])||!record.scopes.includes(scope))throw new HiringError('agent_unauthorized',403,'This token is expired, revoked or lacks the required scope.');
 // Tokens never impersonate staff; every capability requires its explicit scope.
 return record;
}
export const AGENT_SCOPES:AgentScope[]=['jobs:read','jobs:draft','jobs:publish','applicants:read','files:read'];
export function validateAccessScopes(value:unknown):AgentScope[]{
 if(!Array.isArray(value)||!value.length||value.some(scope=>typeof scope!=='string'||!AGENT_SCOPES.includes(scope as AgentScope)))throw new HiringError('invalid_access',422,'Choose valid connection permissions.');
 if(value.includes('files:read')&&!value.includes('applicants:read'))throw new HiringError('invalid_access',422,'Applicant access is required for résumé and file access.');
 return [...new Set(value)] as AgentScope[];
}
/** Updates permissions only; the existing secret hash, expiry and revocation state are immutable here. */
export async function updateAccessScopes(store:HubStore,input:unknown,member:{email:string;isOwner?:boolean}){
 if(member.isOwner!==true)throw new HiringError('owner_access_required',403,'Only the account owner can change connection permissions.');
 if(!input||typeof input!=='object'||Array.isArray(input)||Object.keys(input).some(key=>!['id','scopes'].includes(key)))throw new HiringError('invalid_access',422,'Choose a connection and its permissions.');
 const {id,scopes:raw}=input as {id?:unknown;scopes?:unknown};if(typeof id!=='string'||! /^[a-f0-9-]{36}$/.test(id))throw new HiringError('invalid_access',422,'Choose a connection.');
 const scopes=validateAccessScopes(raw),key='agent_access_'+id,row=await store.stmt('SELECT value FROM hub_settings WHERE key=?',key).first<{value:string}>();
 const current=row?JSON.parse(row.value) as Access:null;
 if(!current||current.id!==id||current.revoked||current.expiresAt<=Date.now())throw new HiringError('access_not_editable',409,'This connection is missing, revoked or expired. Create a new connection instead.');
 const next={...current,scopes},serialized=JSON.stringify(next),now=Date.now();
 try{await store.db.batch([
 store.stmt('UPDATE hub_settings SET value=CASE WHEN value=? THEN ? ELSE NULL END,updated_at=? WHERE key=?',row!.value,serialized,now,key),
 store.stmt('INSERT INTO hub_audit(id,type,actor,before_json,after_json,created_at) VALUES(?,?,CASE WHEN EXISTS(SELECT 1 FROM hub_settings WHERE key=? AND value=?) THEN ? ELSE NULL END,?,?,?)',crypto.randomUUID(),'agent_access_scopes',key,serialized,member.email,JSON.stringify({id,scopes:current.scopes}),JSON.stringify({id,scopes}),now)
 ]);}catch{throw new HiringError('access_changed',409,'This connection changed. Refresh before editing its permissions.');}
 return {id:next.id,name:next.name,scopes:next.scopes,expiresAt:next.expiresAt,revoked:next.revoked};
}
