'use client';
import {useEffect,useRef,useState} from 'react';
import {SecurityCheck} from './security-check';
export function RecruitingHelpForm(){
 const id=useRef('');const [ready,setReady]=useState(false),[token,setToken]=useState(''),[refresh,setRefresh]=useState(0),[busy,setBusy]=useState(false),[error,setError]=useState(''),[receipt,setReceipt]=useState('');
 useEffect(()=>{id.current=crypto.randomUUID();void fetch('/api/recruiting-help',{cache:'no-store'}).then(response=>{if(!response.ok)throw new Error();setReady(true);}).catch(()=>setError('The help form could not load. Please reload this page.'));},[]);
 if(receipt)return <div role="status"><h2>Request received</h2><p>Your reference is <strong>{receipt}</strong>. Save this reference. Your request is waiting for the recruiting team to review it.</p><p>This page confirms your request was received; no email confirmation is sent. Please use this form, rather than replying to automated emails. Submitting a request does not automatically change or delete an application.</p></div>;
 return <form className="application-form" style={{maxWidth:760}} onSubmit={async event=>{
  event.preventDefault();if(busy||!ready||!token)return;const values=new FormData(event.currentTarget);setBusy(true);setError('');
  try{const response=await fetch('/api/recruiting-help',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({id:id.current,email:values.get('email'),job:values.get('job'),kind:values.get('kind'),message:values.get('message'),token:token==='disabled'?'':token})});const body=await response.json() as {error?:{message?:string};data?:{id?:string}};if(!response.ok)throw new Error(body.error?.message||'Your request could not be saved. Try again.');if(!body.data?.id)throw new Error('Your request could not be confirmed. Please retry.');setReceipt(body.data.id);}catch(error){setError(error instanceof Error?error.message:'Your request could not be saved. Try again.');setRefresh(value=>value+1);}finally{setBusy(false);}
 }}><fieldset className="form-fields" disabled={busy}>
 <label className="form-field" style={{display:'grid',gap:8,minWidth:0}}>Email used to apply<input name="email" type="email" required maxLength={254} autoComplete="email"/></label>
 <label className="form-field" style={{display:'grid',gap:8,minWidth:0}}>Job title (optional)<input name="job" maxLength={200}/></label>
 <label className="form-field" style={{display:'grid',gap:8,minWidth:0}}>What do you need help with?<select name="kind" className="form-select"><option value="application">Application support</option><option value="correction">Correct my information</option><option value="withdrawal">Withdraw my application</option><option value="removal">Request removal of my information</option><option value="privacy">Other privacy question</option></select></label>
 <label className="form-field" style={{display:'grid',gap:8,minWidth:0}}>Your request<textarea name="message" required minLength={10} maxLength={4000} rows={6}/></label>
 <p>Please do not include identity documents, passwords, or sensitive information. Staff may need to verify your identity before changing your records.</p>
 <SecurityCheck onToken={setToken} refresh={refresh}/>
 {error&&<p role="alert">{error}</p>}
 <button className="button ink" disabled={busy||!ready||!token}>{busy?'Saving request…':'Send request to recruiting team'}</button>
 </fieldset></form>;
}
