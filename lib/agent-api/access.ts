import { privateToken, sha256 } from '../hiring/crypto';
import { HiringError } from '../hiring/errors';
import type { HubStore } from '../hub/store';
export type AgentScope='jobs:draft'|'jobs:publish';
type Access={id:string;hash:string;name:string;scopes:AgentScope[];createdBy:string;expiresAt:number;revoked:boolean};
export async function issueAccess(store:HubStore,name:string,scopes:AgentScope[],actor:string){
 const id=crypto.randomUUID(),secret=privateToken(),token=`hiring_${id}_${secret}`;
 const record:Access={id,hash:await sha256(token),name:name.slice(0,100),scopes:[...new Set(scopes)],createdBy:actor,expiresAt:Date.now()+90*86400000,revoked:false};
 await store.setSetting('agent_access_'+id,record);return {...record,hash:undefined,token};
}
export async function authorizeAgent(store:HubStore,request:Request,scope:AgentScope){
 const token=request.headers.get('authorization')?.match(/^Bearer (hiring_([a-f0-9-]{36})_[a-f0-9]{64})$/);if(!token)throw new HiringError('agent_unauthorized',401,'A valid scoped agent token is required.');
 const record=await store.setting<Access|null>('agent_access_'+token[2],null);
 if(!record||record.revoked||record.expiresAt<=Date.now()||record.hash!==await sha256(token[1])||!record.scopes.includes(scope))throw new HiringError('agent_unauthorized',403,'This token is expired, revoked or lacks the required scope.');
 // A token never impersonates a staff session and never grants applicant access.
 return record;
}
