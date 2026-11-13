'use client';
import {useRef,useState} from 'react';
import {SecurityCheck} from './security-check';
import {ApplicationForm} from './form';
import {SubmissionRecovery} from './recovery';
import type {CareerJob,CareerField} from './types';

type Grant={grant:string;expiresAt:number};
export function ApplicationGate({job,enabled,mode}:{job:CareerJob;enabled:boolean;mode?:string}){
 const key=useRef('');
 const [token,setToken]=useState(''),[refresh,setRefresh]=useState(0),[busy,setBusy]=useState(false),[error,setError]=useState('');
 const [ready,setReady]=useState<{fields:CareerField[];formVersion?:number;verification:Grant;submissionKey:string}|null>(null);
 async function open(){
  if(busy||!token)return;
  setBusy(true);setError('');
  try{
   if(!key.current){
    try {
     const saved=JSON.parse(sessionStorage.getItem(`aicl:submission:${job.id}`)||'null') as {payload?:{jobPostingId?:unknown;submissionKey?:unknown}}|null;
     if(saved?.payload?.jobPostingId===job.id && typeof saved.payload.submissionKey==='string' && /^[a-zA-Z0-9_-]{16,128}$/.test(saved.payload.submissionKey))key.current=saved.payload.submissionKey;
    } catch { /* Recovery displays its own warning for unreadable journals. */ }
    if(!key.current)key.current=crypto.randomUUID();
   }
   let verified:Grant={grant:'',expiresAt:Date.now()+60000};
   if(token!=='disabled'){
    const response=await fetch('/api/application-verification',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({token,submissionKey:key.current,jobId:job.id})});
    const result=await response.json().catch(()=>({})) as Partial<Grant> & {error?:{message?:string}};
    setToken('');setRefresh(x=>x+1);
    if(!response.ok||typeof result.grant!=='string'||typeof result.expiresAt!=='number'||!Number.isFinite(result.expiresAt))throw new Error(result.error?.message||'Security verification failed. Please try again.');
    verified={grant:result.grant,expiresAt:result.expiresAt};
   }
   const response=await fetch(`/api/jobs/${encodeURIComponent(job.slug)}/form`,{method:'POST',headers:{'Content-Type':'application/json'},cache:'no-store',body:JSON.stringify({submissionKey:key.current,grant:verified.grant})});
   const result=await response.json().catch(()=>({})) as {fields?:CareerField[];formVersion?:number;error?:{message?:string};formUnavailable?:string};
   if(!response.ok||!Array.isArray(result.fields))throw new Error(result.error?.message||result.formUnavailable||'Application questions are unavailable. Please try again.');
   setReady({fields:result.fields,formVersion:result.formVersion,verification:verified,submissionKey:key.current});
  }catch(e){setError(e instanceof Error?e.message:'Unable to open the application. Please try again.');setToken('');setRefresh(x=>x+1);}finally{setBusy(false);}
 }
 if(ready)return <ApplicationForm job={job} fields={ready.fields} enabled={enabled} mode={mode} formVersion={ready.formVersion} initialVerification={{...ready.verification,submissionKey:ready.submissionKey}}/>;
 return <section className="application-form"><h2>Apply for this job</h2><p>Complete the security check to open the application questions.</p><SubmissionRecovery slug={job.slug} canVerify={enabled}/>{enabled&&<><SecurityCheck onToken={setToken} refresh={refresh}/>{error&&<p role="alert">{error}</p>}<button type="button" className="button ink" disabled={!token||busy} onClick={()=>void open()}>{busy?'Opening application…':'Continue to application'}</button></>}{!enabled&&<p>Applications are currently closed.</p>}</section>;
}
