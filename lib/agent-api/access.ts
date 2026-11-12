import { privateToken, sha256 } from '../hiring/crypto';
import { HiringError } from '../hiring/errors';
import type { HubStore } from '../hub/store';
export type AgentScope='jobs:draft'|'jobs:publish'|'jobs:read'|'applicants:read'|'files:read'|'applicants:reject'|'applicants:interview';
type Access={id:string;hash:string;name:string;scopes:AgentScope[];createdBy:string;expiresAt:number|null;revoked:boolean};
export async function issueAccess(store:HubStore,name:string,scopes:AgentScope[],actor:string,noExpiry=true){
 const id=crypto.randomUUID(),secret=privateToken(),token=`hiring_${id}_${secret}`;
 const record:Access={id,hash:await sha256(token),name:name.slice(0,100),scopes:validateAccessScopes(scopes),createdBy:actor,expiresAt:noExpiry?null:Date.now()+90*86400000,revoked:false};
 await store.setSetting('agent_access_'+id,record);return {...record,hash:undefined,token};
}
export async function authorizeAgent(store:HubStore,request:Request,scope:AgentScope){
 const token=request.headers.get('authorization')?.match(/^Bearer (hiring_([a-f0-9-]{36})_[a-f0-9]{64})$/);if(!token)throw new HiringError('agent_unauthorized',401,'A valid scoped agent token is required.');
 const record=await store.setting<Access|null>('agent_access_'+token[2],null);
 if(!record||record.hash!==await sha256(token[1]))throw new HiringError('agent_unauthorized',403,'This connection token is invalid.');
 if(record.revoked)throw new HiringError('agent_unauthorized',403,'This connection has been revoked. Create a new connection in Settings → Integrations → Codex & Claude.');
 if(record.expiresAt!==null&&(!Number.isFinite(record.expiresAt)||record.expiresAt<=Date.now()))throw new HiringError('agent_unauthorized',403,'This connection has expired. Create a new connection in Settings → Integrations → Codex & Claude.');
 if(!record.scopes.includes(scope))throw new HiringError('agent_scope_required',403,`This connection lacks ${scope}. Ask the owner to enable it in Settings → Integrations → Codex & Claude.`);
 // Tokens never impersonate staff; every capability requires its explicit scope.
 return record;
}
export const AGENT_SCOPES:AgentScope[]=['jobs:read','jobs:draft','jobs:publish','applicants:read','files:read','applicants:reject','applicants:interview'];
export function validateAccessScopes(value:unknown):AgentScope[]{
 if(!Array.isArray(value)||!value.length||value.some(scope=>typeof scope!=='string'||!AGENT_SCOPES.includes(scope as AgentScope)))throw new HiringError('invalid_access',422,'Choose valid connection permissions.');
 if(value.includes('applicants:interview')&&!value.includes('applicants:read'))throw new HiringError('invalid_access',422,'Applicant read access is required to request interviews.');
 if(value.includes('applicants:reject')&&!value.includes('applicants:read'))throw new HiringError('invalid_access',422,'Applicant read access is required to reject applicants.');
 if(value.includes('files:read')&&!value.includes('applicants:read'))throw new HiringError('invalid_access',422,'Applicant access is required for résumé and file access.');
 return [...new Set(value)] as AgentScope[];
}
/** Owner edits preserve the secret and revocation; expiry changes require explicit noExpiry=true. */
export async function updateAccessScopes(store:HubStore,input:unknown,member:{email:string;isOwner?:boolean}){
 if(member.isOwner!==true)throw new HiringError('owner_access_required',403,'Only the account owner can change connection permissions.');
 if(!input||typeof input!=='object'||Array.isArray(input)||Object.keys(input).some(key=>!['id','scopes','noExpiry'].includes(key)))throw new HiringError('invalid_access',422,'Choose a connection and its permissions.');
 const {id,scopes:raw,noExpiry}=input as {id?:unknown;scopes?:unknown;noExpiry?:unknown};if(noExpiry!==undefined&&noExpiry!==true)throw new HiringError('invalid_access',422,'Use noExpiry=true to remove the expiry.');if(typeof id!=='string'||! /^[a-f0-9-]{36}$/.test(id))throw new HiringError('invalid_access',422,'Choose a connection.');
 const scopes=validateAccessScopes(raw),key='agent_access_'+id,row=await store.stmt('SELECT value FROM hub_settings WHERE key=?',key).first<{value:string}>();
 const current=row?JSON.parse(row.value) as Access:null;
 if(!current||current.id!==id||current.revoked||(current.expiresAt!==null&&(!Number.isFinite(current.expiresAt)||current.expiresAt<=Date.now())))throw new HiringError('access_not_editable',409,'This connection is missing, revoked or expired. Create a new connection instead.');
 const next={...current,scopes,...(noExpiry===true?{expiresAt:null}:{})},serialized=JSON.stringify(next),now=Date.now();
 try{await store.db.batch([
 store.stmt('UPDATE hub_settings SET value=CASE WHEN value=? THEN ? ELSE NULL END,updated_at=? WHERE key=?',row!.value,serialized,now,key),
 store.stmt('INSERT INTO hub_audit(id,type,actor,before_json,after_json,created_at) VALUES(?,?,CASE WHEN EXISTS(SELECT 1 FROM hub_settings WHERE key=? AND value=?) THEN ? ELSE NULL END,?,?,?)',crypto.randomUUID(),'agent_access_scopes',key,serialized,member.email,JSON.stringify({id,scopes:current.scopes,expiresAt:current.expiresAt}),JSON.stringify({id,scopes,expiresAt:next.expiresAt}),now)
 ]);}catch{throw new HiringError('access_changed',409,'This connection changed. Refresh before editing its permissions.');}
 return {id:next.id,name:next.name,scopes:next.scopes,expiresAt:next.expiresAt,revoked:next.revoked};
}
