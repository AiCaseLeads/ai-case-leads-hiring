import {requireHubMember,requireHubOwner} from '@/lib/hub/auth';
import {getHubStore} from '@/lib/hub/runtime';
import {assertSameOrigin,errorResponse,jsonResponse} from '@/lib/hiring/http';
import {issueAccess,type AgentScope} from '@/lib/agent-api/access';
import {readBody} from '@/lib/job-import/handler';
import {HiringError} from '@/lib/hiring/errors';
export const dynamic='force-dynamic';
const allowed=['jobs:read','jobs:draft','jobs:publish','applicants:read','files:read'];
export async function GET(r:Request){try{
 const m=await requireHubMember(r);requireHubOwner(m);const store=await getHubStore(r);
 const rows=await store.rows<{value:string}>("SELECT value FROM hub_settings WHERE key LIKE 'agent_access_%'");
 return jsonResponse({data:rows.map(x=>{const entry=JSON.parse(x.value);return {id:entry.id,name:entry.name,scopes:entry.scopes,expiresAt:entry.expiresAt,revoked:entry.revoked};})});
}catch(e){return errorResponse(e);}}
export async function POST(r:Request){try{
 const m=await requireHubMember(r);requireHubOwner(m);assertSameOrigin(r);const i=await readBody(r);
 if(!i||typeof i!=='object'||Array.isArray(i)||typeof i.name!=='string'||!i.name.trim()||i.name.trim().length>100||!Array.isArray(i.scopes)||!i.scopes.length||i.scopes.some((s:unknown)=>typeof s!=='string'||!allowed.includes(s)))throw new HiringError('invalid_access',422,'Name the connection and choose its permissions.');
 if(i.scopes.includes('files:read')&&!i.scopes.includes('applicants:read'))throw new HiringError('invalid_access',422,'Applicant access is required for résumé and file access.');
 return jsonResponse({data:await issueAccess(await getHubStore(r),i.name.trim(),i.scopes as AgentScope[],m.email)});
}catch(e){return errorResponse(e);}}
export async function DELETE(r:Request){try{
 const m=await requireHubMember(r);requireHubOwner(m);assertSameOrigin(r);const i=await readBody(r);
 if(!i||typeof i.id!=='string'||! /^[a-f0-9-]{36}$/.test(i.id))throw new HiringError('invalid_access',422,'Choose a connection.');
 const store=await getHubStore(r),key='agent_access_'+i.id,entry=await store.setting<Record<string,unknown>|null>(key,null);
 if(entry)await store.setSetting(key,{...entry,revoked:true});return jsonResponse({data:{revoked:true}});
}catch(e){return errorResponse(e);}}
