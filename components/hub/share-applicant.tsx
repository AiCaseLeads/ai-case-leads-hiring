"use client";
import {useRef,useState} from "react";
import {X,Link as LinkIcon,LockKeyhole,Building2} from "lucide-react";
import {hubRequest} from "./api";
import "./share-applicant.css";
type Access="people"|"company"|"public";
type ShareStatus={active:boolean;expiresAt?:number;access?:Access;emails?:string[]};
export function ShareApplicant({id}:{id:string}) {
 const dialog=useRef<HTMLDialogElement>(null);
 const [busy,setBusy]=useState(false),[loaded,setLoaded]=useState(false),[active,setActive]=useState(false);
 const [expires,setExpires]=useState<number|null>(null),[days,setDays]=useState(7),[url,setUrl]=useState("");
 const [notice,setNotice]=useState(""),[access,setAccess]=useState<Access>("people"),[people,setPeople]=useState("");
 const emails=people.split(/[\s,;]+/).map(value=>value.trim()).filter(Boolean);
 const validPeople=emails.length>0&&emails.every(email=>/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email));
 async function open(){
  setUrl("");dialog.current?.showModal();setBusy(true);setLoaded(false);setNotice("");
  try{const data=await hubRequest<ShareStatus>(`/api/hub/applications/${encodeURIComponent(id)}/share`);setLoaded(true);setActive(data.active);setExpires(data.expiresAt||null);setAccess(data.access||"people");setPeople((data.emails||[]).join(", "));}
  catch{setNotice("Could not load sharing status. Close and try again.");}finally{setBusy(false);}
 }
 async function create(){
  if(busy||!loaded||access==="people"&&!validPeople)return;
  setBusy(true);setNotice("");
  try{const data=await hubRequest<{url:string;expiresAt:number}>(`/api/hub/applications/${encodeURIComponent(id)}/share`,"POST",{expiresInDays:days,access,emails:access==="people"?emails:[]});setUrl(new URL(data.url,location.origin).href);setActive(true);setExpires(data.expiresAt);setNotice("Link ready. Copy it and send it to the people you want to share with.");}
  catch(error){setNotice(error instanceof Error?error.message:"Could not create the link.");}finally{setBusy(false);}
 }
 async function invite(){
  if(busy||!url||access!=="people")return;setBusy(true);setNotice("");
  try{const token=new URL(url).pathname.split("/").pop();const result=await hubRequest<{sent:number;alreadySent:number;failed:number;uncertain:number}>(`/api/hub/applications/${encodeURIComponent(id)}/share-invitations`,"POST",{token});setNotice(`${result.sent} invitations sent; ${result.alreadySent} already sent.${result.failed?` ${result.failed} failed.`:""}${result.uncertain?` ${result.uncertain} could not be confirmed. Check delivery before retrying.`:""}`);}
  catch(error){setNotice(error instanceof Error?error.message:"Could not send invitations.");}finally{setBusy(false);}
 }
 async function revoke(){
  if(busy)return;setBusy(true);
  try{await hubRequest(`/api/hub/applications/${encodeURIComponent(id)}/share`,"DELETE",{});setActive(false);setUrl("");setExpires(null);setNotice("Link revoked.");}
  catch(error){setNotice(error instanceof Error?error.message:"Could not revoke the link.");}finally{setBusy(false);}
 }
 return <>
  <button type="button" className="hub-button secondary" onClick={()=>void open()}>Share applicant</button>
  <dialog ref={dialog} className="hub-share-dialog" aria-labelledby="share-applicant-title" onClick={event=>{if(event.target===event.currentTarget){const rect=event.currentTarget.getBoundingClientRect();if(event.clientX<rect.left||event.clientX>rect.right||event.clientY<rect.top||event.clientY>rect.bottom)dialog.current?.close();}}}>
   <header className="hub-share-heading"><h2 id="share-applicant-title">Share applicant</h2><button type="button" className="hub-icon-button" aria-label="Close sharing" onClick={()=>dialog.current?.close()}><X size={20}/></button></header>
   <p className="hub-share-description">Share contact details, résumé, answers, and AI review. Internal notes and emails stay private.</p>
   <label className="hub-share-label" htmlFor={`share-access-${id}`}>Who can open the link?</label>
   <div className="hub-share-access">{access==="people"?<LockKeyhole size={20}/>:access==="company"?<Building2 size={20}/>:<LinkIcon size={20}/>}<select id={`share-access-${id}`} value={access} disabled={busy} onChange={event=>{setAccess(event.target.value as Access);setUrl("");}}><option value="people">Specific people</option><option value="company">AI Case Leads</option><option value="public">Anyone with the link</option></select></div>
   {access==="people"?<label className="hub-share-people">People’s email addresses<input value={people} disabled={busy} placeholder="name@company.com, another@company.com" onChange={event=>{setPeople(event.target.value);setUrl("");}}/><small>They must verify access using a code sent to their email.</small></label>:<p className="hub-share-hint">{access==="company"?"People with a verified @aicaseleads.com email address can view.":"Anyone who receives this link can view without signing in."}</p>}
   <details className="hub-share-expiry"><summary>Link expiration · {days} days</summary><label>Expires after<select value={days} disabled={busy} onChange={event=>{setDays(Number(event.target.value));setUrl("");}}><option value={7}>7 days</option><option value={30}>30 days</option></select></label></details>
   {active&&<p className="hub-share-hint">An active link expires {expires?new Date(expires).toLocaleDateString():"soon"}. Replacing it stops the old link from working.</p>}
   {url&&<label className="hub-share-link">Share link<input readOnly value={url} onFocus={event=>event.target.select()}/></label>}
   {notice&&<p role="status" className="hub-share-notice">{notice}</p>}
   {url&&access==="people"&&<button type="button" className="hub-button secondary" disabled={busy} onClick={()=>void invite()}>Send email invitations</button>}
   <footer className="hub-share-footer">{active&&<button type="button" className="hub-text-button" disabled={busy} onClick={()=>void revoke()}>Revoke link</button>}<div>{url?<button type="button" className="hub-button" onClick={()=>void navigator.clipboard.writeText(url).then(()=>setNotice("Link copied.")).catch(()=>setNotice("Select and copy the link above."))}>Copy link</button>:<button type="button" className="hub-button" disabled={busy||!loaded||access==="people"&&!validPeople} onClick={()=>void create()}>{busy?"Working…":active?"Replace link":"Create link"}</button>}</div></footer>
  </dialog>
 </>;
}
