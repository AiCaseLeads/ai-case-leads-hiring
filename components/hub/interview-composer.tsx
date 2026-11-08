'use client';
import {useEffect,useLayoutEffect,useRef,useState,Fragment} from 'react';
import {HubError,hubRequest,useHubResource} from './api';
import {Field,ResourceState,Feedback} from './shared';
import {refreshedInterviewDraft,defaultInterviewOrganizer,InterviewPreviewEpoch,interviewPreviewRecovery} from './interview-draft-state';
type Template={subject:string;body:string;version:number;variables?:string[]};
type Readiness={sender:string|null;cc?:string[];replyTo?:string[];interviewerEmail?:string;mailReady:boolean;mailIssue:string|null;companyGoogleReady:boolean;sharedCalendarReady:boolean;renewCalendarReady:boolean;hasActiveInterview:boolean;interviewers:{email:string;ready:boolean}[]};
export type InterviewDraftPayload={expectedRevision?:number;subject:string;body:string;templateVersion:number;previewFingerprint:string;bookingToken?:string;internalNote:string};
type Preview={bookingUrl?:string;bookingToken?:string;applicationRevision:number;subject:string;body:string;fingerprint:string;envelope:{sender:string;to:string;cc:string[];replyTo:string[]};readiness:Readiness};
export function InterviewComposer({applicationId,jobId,name,jobTitle,email,value,change,renew,reviewerEmail,sendErrorCode,ready,draft,dirty}:{applicationId:string;jobId:string;name:string;jobTitle:string;email:string;value:string;change:(v:string)=>void;renew:boolean;reviewerEmail?:string;sendErrorCode?:string;ready:(v:boolean)=>void;draft:(v:InterviewDraftPayload|null)=>void;dirty:(v:boolean)=>void;cancel:()=>void}){
 const template=useHubResource<Template>('/api/interview-template'),setup=useHubResource<Readiness>('/api/interview-readiness?applicationId='+encodeURIComponent(applicationId)+(!renew&&value&&value!=='__shared__'?'&interviewerEmail='+encodeURIComponent(value):''));
 const [subject,setSubject]=useState(''),[body,setBody]=useState(''),[note,setNote]=useState(''),[preview,setPreview]=useState<(Preview & {ticket:number})|null>(null),[error,setError]=useState(''),[busy,setBusy]=useState(false);
 const emailEdited=useRef(false),initialized=useRef(false),organizerInitialized=useRef(false),previewEpoch=useRef(new InterviewPreviewEpoch());
 const [sessionBlocked,setSessionBlocked]=useState(false),[refreshCount,setRefreshCount]=useState(0);
 const [templateStale,setTemplateStale]=useState(false),[templateVersionOverride,setTemplateVersionOverride]=useState<number|undefined>();
 useLayoutEffect(()=>{const current=previewEpoch.current;current.mount();return()=>current.dispose()},[]);
 useEffect(()=>{if(template.data&&!initialized.current){initialized.current=true;setSubject(template.data.subject);setBody(template.data.body)}},[template.data]);
 useEffect(()=>{
  const recovery=interviewPreviewRecovery(sendErrorCode);
  if(!recovery)return;
  let cancelled=false;
  queueMicrotask(()=>{
   if(cancelled)return;
   if(recovery==='template')setTemplateStale(true);
   else setRefreshCount(count=>count+1);
  });
  return()=>{cancelled=true};
 },[sendErrorCode]);
 const reloadSetup=setup.reload;
 useEffect(()=>{
  const expired=()=>{previewEpoch.current.invalidate();setSessionBlocked(true);ready(false);draft(null)};
  const restored=()=>{setSessionBlocked(false);setRefreshCount(count=>count+1);void reloadSetup()};
  window.addEventListener('hub:session-expired',expired);window.addEventListener('hub:session-restored',restored);
  return()=>{window.removeEventListener('hub:session-expired',expired);window.removeEventListener('hub:session-restored',restored)};
 },[reloadSetup,ready,draft]);
 const data=setup.data;
 useEffect(()=>{if(!data||organizerInitialized.current||(!reviewerEmail&&!renew))return;let cancelled=false;queueMicrotask(()=>{if(cancelled)return;organizerInitialized.current=true;const selected=defaultInterviewOrganizer(value,renew,reviewerEmail,data.interviewers);if(selected!==value)change(selected)});return()=>{cancelled=true}},[data,value,renew,reviewerEmail,change]);
 const calendarReady=!!data?.companyGoogleReady&&(renew?data.hasActiveInterview&&data.renewCalendarReady:value==='__shared__'?data.sharedCalendarReady:!!data.interviewers.find(p=>p.email===value&&p.ready));
 const version=templateVersionOverride??template.data?.version;
 const canPrepare=!!(version && subject.trim() && body.trim() && data?.mailReady && calendarReady && (!data.hasActiveInterview || renew) && !sessionBlocked && !templateStale);
 useLayoutEffect(()=>{
  const epoch=previewEpoch.current;
  const ticket=epoch.begin();
  queueMicrotask(()=>{
   if(!epoch.accept(ticket))return;
   setPreview(null);setError('');ready(false);draft(null);setBusy(canPrepare);
  });
  if(!canPrepare)return()=>epoch.invalidate();
  const timer=window.setTimeout(async()=>{
   try {
    const next=await hubRequest<Preview>('/api/interview-preview','POST',{
     applicationId,subject,body,templateVersion:version,renew,
     ...(!renew&&value!=='__shared__'?{interviewerEmail:value}:{}),
    });
    if(previewEpoch.current.accept(ticket))setPreview({...next,ticket});
   } catch (err) {
    if(!previewEpoch.current.accept(ticket))return;
    if(err instanceof HubError&&err.code==='template_changed')setTemplateStale(true);
    else setError(err instanceof Error?err.message:'Could not prepare the invitation.');
   } finally {if(previewEpoch.current.accept(ticket))setBusy(false)}
  },250);
  return()=>{window.clearTimeout(timer);epoch.invalidate()};
 },[canPrepare,applicationId,subject,body,version,renew,value,refreshCount,draft,ready]);
 useLayoutEffect(()=>{
  if(!preview||!canPrepare||!version||!previewEpoch.current.accept(preview.ticket))return;
  const r=preview.readiness;
  const readyToSend=r.mailReady&&r.companyGoogleReady&&(renew?r.hasActiveInterview&&r.renewCalendarReady:value==='__shared__'?r.sharedCalendarReady:r.interviewers.some(person=>person.email===value&&person.ready));
  if(!readyToSend)return;
  draft({subject,body,templateVersion:version,previewFingerprint:preview.fingerprint,internalNote:note,
   ...(preview.bookingToken?{bookingToken:preview.bookingToken}:{}),
   ...(Number.isSafeInteger(preview.applicationRevision)?{expectedRevision:preview.applicationRevision}:{})});
  ready(true);
 },[preview,canPrepare,version,note,subject,body,renew,value,draft,ready]);
 function edit(s:string,b:string,n:string){if(s!==subject||b!==body)emailEdited.current=true;setSubject(s);setBody(b);setNote(n);dirty(true)}
 const example=(value:string)=>value.replace(/{{\s*(name|jobTitle|companyName|interviewerName|bookingLink|linkExpiry|senderName)\s*}}/g,(_,key:string)=>({name,jobTitle,companyName:'AI Case Leads',interviewerName:'our hiring team',bookingLink:'[Your private booking link will appear here]',linkExpiry:'Fourteen days after sending',senderName:'AI Case Leads Hiring Team'} as Record<string,string>)[key]);
 const myCalendar=data?.interviewers.find(p=>p.email===reviewerEmail);
 return <div className="hub-interview-composer"><ResourceState loading={setup.loading||template.loading} error={setup.error||template.error} retry={()=>{void setup.reload();void template.reload()}}/>
 <div className="hub-interview-readiness" aria-label="Interview setup"><h4>Interview setup</h4>
 {data&&<>{data.hasActiveInterview&&!renew&&<p className="hub-notice">This applicant already has an invitation. Select replacement mode above to revoke it and send a new link.</p>}<p><strong>Sending from:</strong> {data.sender||'Setup needed'}</p><p><strong>Replies go to:</strong> {data.replyTo?.join(', ')||'Choose an interviewer'}</p>{!data.mailReady&&<div className="hub-notice">{data.mailIssue==='interview_owner_pinned'?<>A replacement keeps the original interviewer. Select replacement mode, or cancel the existing interview before choosing someone else.</>:data.mailIssue==='interviewer_not_active'?<>The selected interviewer is no longer active. Cancel the existing interview before choosing another interviewer.</>:data.mailIssue==='recruiter_reply_contact_required'?<>Choose an active owner, manager or recruiter to handle candidate replies. <a target="_blank" rel="noopener" href={'/team?view=jobs&jobEditor='+encodeURIComponent(jobId)+'&jobStep=2'}>Open job hiring team</a></>:<>{data.sender===reviewerEmail?<>Connect your Gmail to send this invitation and receive replies. <a target="_blank" rel="noopener" href="/team?view=settings&section=personal">Open my email setup</a></>:<>Ask {data.sender||'the sender'} to connect Gmail in Settings → My calendar &amp; email. <a target="_blank" rel="noopener" href={'/team?view=jobs&jobEditor='+encodeURIComponent(jobId)+'&jobStep=2'}>Choose another reply contact</a></>}</>}</div>}
 {!data.companyGoogleReady&&<p className="hub-notice">Company scheduling needs attention. <a target="_blank" rel="noopener" href="/team?view=settings&section=integrations">Open company connections</a></p>}
 <Field label="Interviewer" hint={renew?'A replacement keeps the original organizer.':'Choose who will conduct the interview.'}><select value={renew?(data.interviewerEmail||'__shared__'):value} disabled={renew} onChange={e=>{organizerInitialized.current=true;previewEpoch.current.invalidate();ready(false);draft(null);change(e.target.value);dirty(true)}}><option value="">{renew?'Keep original organizer':'Choose interviewer'}</option><option value="__shared__" disabled={!data.sharedCalendarReady}>Company calendar{data.sharedCalendarReady?'':' — setup needed'}</option>{data.interviewers.map(p=><option key={p.email} value={p.email} disabled={!p.ready}>{p.email}{p.ready?'':' — setup needed'}</option>)}</select></Field>
 {myCalendar&&!myCalendar.ready&&<p className="hub-notice">Your calendar needs setup. <a target="_blank" rel="noopener" href="/team?view=settings&section=personal">Connect my calendar and set hours</a></p>}
 {!calendarReady&&<p className="hub-muted">Choose a ready calendar, or <a target="_blank" rel="noopener" href="/team?view=settings&section=personal">set up your interview calendar</a>.</p>}
 <button className="hub-text-button" type="button" onClick={()=>{setRefreshCount(count=>count+1);void setup.reload()}}>Recheck connections</button></>}
 </div><details className="hub-interview-email-editor"><summary>Customize this email</summary><Field label="Email subject"><input required maxLength={300} value={subject} onChange={e=>edit(e.target.value,body,note)}/></Field><Field label="Email message" hint="These edits apply only to this invitation. Keep {{bookingLink}} in the message."><textarea required rows={8} maxLength={20000} value={body} onChange={e=>edit(subject,e.target.value,note)}/></Field>
 <details><summary>Supported variables</summary><p>{template.data?.variables?.map(v=>'{{'+v+'}}').join(' · ')}</p></details></details>
 <details><summary>Add internal note — not emailed</summary><Field label="Internal recruiter note — not emailed" hint="Saved privately in this applicant’s notes when you send the invitation."><textarea rows={3} maxLength={20000} value={note} onChange={e=>edit(subject,body,e.target.value)}/></Field></details>
 {busy&&<p role="status" className="hub-muted">Preparing invitation…</p>}<Feedback error={error}/>{error&&!templateStale&&<button type="button" className="hub-text-button" onClick={()=>setRefreshCount(count=>count+1)}>Retry</button>}{templateStale&&<button className="hub-button secondary" type="button" disabled={template.loading} onClick={async()=>{const ticket=previewEpoch.current.begin();setBusy(false);setPreview(null);ready(false);draft(null);try{const latest=await hubRequest<Template>("/api/interview-template");if(latest&&previewEpoch.current.accept(ticket)){const retained=refreshedInterviewDraft({subject,body},latest,emailEdited.current);setSubject(retained.subject);setBody(retained.body);setTemplateVersionOverride(retained.templateVersion);void template.reload();setTemplateStale(false);setError("")}}catch(e){if(!previewEpoch.current.accept(ticket))return;setError(e instanceof Error?e.message:"Could not refresh the default template.")}}}>Refresh template version</button>}
 <section className="hub-interview-preview" aria-label="Email preview"><h4>Email preview</h4><p><strong>To:</strong> {email}</p>{preview&&<><p><strong>From:</strong> {preview.envelope.sender}</p><p><strong>Reply-To:</strong> {preview.envelope.replyTo.join(', ')}</p><p><strong>CC:</strong> {preview.envelope.cc.join(', ')||'None'}</p>{reviewerEmail&&preview.envelope.cc.includes(reviewerEmail)&&<p className="hub-muted">{preview.envelope.replyTo.includes(reviewerEmail)?'You are copied and receive replies.':'Replies go to the selected interviewer. Reply all includes you.'}</p>}</>}<strong>{preview?.subject||example(subject)}</strong><pre style={{whiteSpace:'pre-wrap',fontFamily:'inherit'}}>{preview?.bookingUrl ? preview.body.split(preview.bookingUrl).map((part,i)=><Fragment key={i}>{i>0&&<a href={preview.bookingUrl} target="_blank" rel="noopener noreferrer">{preview.bookingUrl}</a>}{part}</Fragment>) : preview?.body||example(body)}</pre></section>
 </div>;
}
export function InterviewDiscardConfirmation({busy,keep,discard}:{busy:boolean;keep:()=>void;discard:()=>void}){
 const keepButton=useRef<HTMLButtonElement>(null);useLayoutEffect(()=>{keepButton.current?.focus()},[]);
 return <div role="alertdialog" aria-labelledby="interview-discard-title" aria-describedby="interview-discard-description" className="hub-notice hub-interview-discard"><h4 id="interview-discard-title">Discard this unsent invitation?</h4><p id="interview-discard-description">Your email edits and internal note will be removed. No email has been sent.</p><div className="hub-button-row"><button ref={keepButton} type="button" className="hub-button secondary" disabled={busy} onClick={keep}>Keep editing</button><button type="button" className="hub-button danger" disabled={busy} onClick={discard}>Discard invitation</button></div></div>;
}
export function InterviewTemplateSettings({isOwner}:{isOwner:boolean}){
 const resource=useHubResource<Template>('/api/interview-template');const [subject,setSubject]=useState(''),[body,setBody]=useState(''),[error,setError]=useState(''),[success,setSuccess]=useState(''),[busy,setBusy]=useState(false);
 useEffect(()=>{if(!resource.data)return;let cancelled=false;queueMicrotask(()=>{if(!cancelled&&resource.data){setSubject(resource.data.subject);setBody(resource.data.body)}});return()=>{cancelled=true}},[resource.data]);
 async function save(reset=false){if(!resource.data)return;setBusy(true);setError('');setSuccess('');try{await hubRequest('/api/interview-template','PATCH',{subject,body,version:resource.data.version,reset});await resource.reload();setSuccess(reset?'Default invitation restored.':'Default invitation saved. Individual invitations keep their own edits.')}catch(e){setError(e instanceof Error?e.message:'Could not save template.')}finally{setBusy(false)}}
 return <section className="hub-card"><h3>Interview invitation</h3><p>Automatically filled for every new interview invitation. Recruiters can customize an individual email before sending.</p><ResourceState loading={resource.loading} error={resource.error} retry={()=>void resource.reload()}/>{resource.data&&<><Field label="Default subject"><input disabled={!isOwner||busy} value={subject} maxLength={300} onChange={e=>setSubject(e.target.value)}/></Field><Field label="Default message" hint="Use {{name}}, {{jobTitle}}, {{companyName}}, {{interviewerName}}, {{bookingLink}}, {{linkExpiry}} and {{senderName}}. The booking link is required."><textarea disabled={!isOwner||busy} rows={9} maxLength={20000} value={body} onChange={e=>setBody(e.target.value)}/></Field><details><summary>Preview default email</summary><p className="hub-muted">Example applicant and role; no email is sent.</p><strong>{subject.replaceAll("{{jobTitle}}","Example role").replaceAll("{{name}}","Alex Applicant")}</strong><pre style={{whiteSpace:"pre-wrap",fontFamily:"inherit"}}>{body.replaceAll("{{name}}","Alex Applicant").replaceAll("{{jobTitle}}","Example role").replaceAll("{{companyName}}","AI Case Leads").replaceAll("{{interviewerName}}","Your interviewer").replaceAll("{{bookingLink}}","[Private booking link]").replaceAll("{{linkExpiry}}","Fourteen days after sending").replaceAll("{{senderName}}","Hiring team")}</pre></details><p className="hub-muted">Version {resource.data.version}. {isOwner?'Only the owner changes company defaults.':'Ask the owner to change this company default.'}</p>{isOwner&&<div className="hub-button-row"><button type="button" className="hub-button" disabled={busy} onClick={()=>void save()}>Save default</button><button type="button" className="hub-button secondary" disabled={busy} onClick={()=>void save(true)}>Restore built-in default</button></div>}<Feedback error={error} success={success}/></>}</section>;
}
