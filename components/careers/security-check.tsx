'use client';
import { useEffect, useRef, useState } from 'react';
type Turnstile = { render: (element: HTMLElement, options: Record<string, unknown>) => string; remove: (id: string) => void };
declare global { interface Window { turnstile?: Turnstile } }
export function SecurityCheck({ onToken, refresh }: { onToken: (token: string) => void; refresh: number }) {
  const target = useRef<HTMLDivElement>(null);
  const callback = useRef(onToken);
  const [message,setMessage] = useState('Loading security check…');
  useEffect(()=>{ callback.current = onToken; },[onToken]);
  useEffect(()=>{
    let disposed=false, id: string | undefined, timer: ReturnType<typeof setInterval> | undefined;
    callback.current('');
    void fetch('/api/application-verification',{cache:'no-store'}).then(async response=>{
      if(!response.ok) throw new Error();
      const config = await response.json() as {required:boolean;configured:boolean;siteKey:string};
      if(disposed) return;
      if(!config.required) { setMessage(''); callback.current('disabled'); return; }
      if(!config.configured) {setMessage('Security verification is temporarily unavailable. Please try again later.');return;}
      if(!document.querySelector('script[data-application-turnstile]')) {
        const script=document.createElement('script'); script.src='https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit'; script.async=true; script.dataset.applicationTurnstile='true';
        script.onerror=()=>{if(!disposed)setMessage('Could not load the security check. Reload this page or check your connection.');}; document.head.appendChild(script);
      }
      let attempts=0;
      timer=setInterval(()=>{
        if(disposed) return;
        if(++attempts>100){clearInterval(timer);setMessage('Security check is taking too long. Please reload the page.');return;}
        if(!window.turnstile || !target.current) return;
        clearInterval(timer);setMessage('');
        id=window.turnstile.render(target.current,{sitekey:config.siteKey,action:'application',size:'flexible',callback:(token:string)=>callback.current(token),'expired-callback':()=>callback.current(''),'error-callback':()=>{callback.current('');setMessage('Security check failed. Please retry or reload this page.');}});
      },200);
    }).catch(()=>{if(!disposed)setMessage('Could not load security verification. Please reload the page.');});
    return()=>{disposed=true;if(timer)clearInterval(timer);if(id)window.turnstile?.remove(id);};
  },[refresh]);
  return <div className="application-security-check" style={{marginBlock:'1rem',minWidth:0}}><div ref={target}/>{message&&<p role="status">{message}</p>}</div>;
}
