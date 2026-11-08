'use client';
import {useCallback,useEffect,useRef,useState} from 'react';
import {hubRequest,HubError} from './api';
export function SessionBoundary({email,onRestored}:{email:string;onRestored:()=>void}){
 const [expired,setExpired]=useState(false),[error,setError]=useState(''),[checking,setChecking]=useState(false);
 const dialog=useRef<HTMLDialogElement>(null),busy=useRef(false),restore=useRef(onRestored);
 useEffect(()=>{restore.current=onRestored},[onRestored]);
 const check=useCallback(async()=>{if(busy.current)return;busy.current=true;setChecking(true);setError('');try{const identity=await hubRequest<{email:string}>('/api/hub-session');if(identity.email.toLowerCase()!==email.toLowerCase()){setError(`Sign in as ${email} to resume these entries. To switch accounts, reload the workspace instead.`);return}setExpired(false);restore.current();window.dispatchEvent(new Event('hub:session-restored'));}catch(e){setError(e instanceof HubError&&(e.code==='staff_access_required'||e.status===401)?'You are not signed in yet. Sign in in the other tab, then check again.':'We could not verify sign-in right now. Your entries remain here; try checking again shortly.')}finally{busy.current=false;setChecking(false)}},[email]);
 useEffect(()=>{const expire=()=>setExpired(true);window.addEventListener('hub:session-expired',expire);return()=>window.removeEventListener('hub:session-expired',expire)},[]);
 useEffect(()=>{if(expired){dialog.current?.showModal();const focus=()=>void check();window.addEventListener('focus',focus);return()=>window.removeEventListener('focus',focus)}dialog.current?.close()},[expired,check]);
 return <dialog ref={dialog} className="hub-session-dialog" aria-labelledby="hub-session-title" onCancel={e=>e.preventDefault()}><h2 id="hub-session-title">Sign in to continue</h2><p>Your session ended. Your unsent entries remain open in this tab.</p><p>Sign in as <strong>{email}</strong> in another tab, then return here.</p><div className="hub-session-actions"><a className="hub-button" href="/team" target="_blank" rel="noopener noreferrer">Open sign-in</a><button className="hub-button secondary" type="button" disabled={checking} onClick={()=>void check()}>{checking?'Checking…':'I’ve signed in — continue'}</button></div>{error&&<p role="alert">{error}</p>}</dialog>;
}
