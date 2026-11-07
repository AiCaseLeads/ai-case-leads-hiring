'use client';
import {useEffect,useState} from 'react';
type Entry={id:string;name:string;scopes:string[];expiresAt:number;revoked:boolean};
const scopeLabels:Record<string,string>={'jobs:read':'View jobs','jobs:draft':'Draft jobs','jobs:publish':'Publish jobs','applicants:read':'Read applicants and interview information','files:read':'Read résumés and uploaded files'};
export function AgentAccess({isOwner}:{isOwner:boolean}){
 const[entries,setEntries]=useState<Entry[]>([]),[name,setName]=useState('Codex / Claude'),[publish,setPublish]=useState(false),[applicants,setApplicants]=useState(false),[files,setFiles]=useState(false),[token,setToken]=useState(''),[error,setError]=useState(''),[busy,setBusy]=useState(false);
 useEffect(()=>{if(!isOwner)return;let cancelled=false;fetch('/api/agent-access').then(r=>r.ok?r.json():null).then(value=>{if(value&&!cancelled)setEntries((value as {data:Entry[]}).data)}).catch(()=>{if(!cancelled)setError('Could not load connections.')});return()=>{cancelled=true}},[isOwner]);
 async function mutate(method:string,body:unknown){
  setError('');setBusy(true);
  try{const r=await fetch('/api/agent-access',{method,headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});const j=await r.json() as {data?:{token?:string};error?:{message?:string}};if(!r.ok)throw new Error(j.error?.message||'Connection could not be changed.');if(j.data?.token)setToken(j.data.token);const list=await fetch('/api/agent-access');if(list.ok)setEntries((await list.json() as {data:Entry[]}).data);else setError('Connection changed. Refresh to see the updated list.');}
  catch(e){setError(e instanceof Error?e.message:'Connection could not be changed.');}
  finally{setBusy(false);}
 }
 if(!isOwner)return null;
 const scopes=['jobs:read','jobs:draft',...(publish?['jobs:publish']:[]),...(applicants?['applicants:read']:[]),...(applicants&&files?['files:read']:[])];
 return <section className="hub-card"><h3>Codex and Claude connections</h3><p>Connect an assistant to your hiring workspace. Choose whether it can read applicants, résumés and interview information. Connections expire after 90 days and can be revoked at any time.</p>{error&&<p role="alert">{error}</p>}
 <label>Connection name<input value={name} onChange={e=>setName(e.target.value)}/></label>
 <p>Includes viewing jobs and preparing job drafts.</p>
 <label><input type="checkbox" checked={applicants} onChange={e=>{setApplicants(e.target.checked);if(!e.target.checked)setFiles(false)}}/>Read applicants, answers, AI reviews, recruiter notes, interview information and communication history</label>
 <label><input type="checkbox" checked={files} disabled={!applicants} onChange={e=>setFiles(e.target.checked)}/>Read résumé text and download original uploaded files</label>
 <label><input type="checkbox" checked={publish} onChange={e=>setPublish(e.target.checked)}/>Allow publishing reviewed jobs</label>
 <p>Applicant access shares private recruiting records with the assistant using this connection. It does not allow shortlisting, rejection, deletion or sending emails. Existing connections keep their original permissions.</p>
 <button className="hub-button secondary" type="button" disabled={busy||!name.trim()||!!token} onClick={()=>void mutate('POST',{name,scopes})}>{busy?'Saving…':'Create connection'}</button>
 {token&&<div role="status"><p>Copy this token now and store it in your assistant’s connection settings. It will not be shown again. Do not paste it into chat.</p><input type="password" readOnly value={token} aria-label="New agent token"/><button type="button" onClick={()=>void navigator.clipboard.writeText(token).catch(()=>setError('Copy failed. Select and copy the token field directly.'))}>Copy connection token</button><button type="button" onClick={()=>setToken('')}>I have saved it</button></div>}
 {entries.map(e=><div className="hub-history-item" key={e.id}><strong>{e.name}</strong><p>{e.scopes.map(s=>scopeLabels[s]||s).join(' · ')} · {e.revoked?'Revoked':`Expires ${new Date(e.expiresAt).toLocaleDateString()}`}</p>{!e.revoked&&<button type="button" disabled={busy} className="hub-text-button" onClick={()=>void mutate('DELETE',{id:e.id})}>Revoke</button>}</div>)}</section>
}
