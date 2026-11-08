"use client";
import {useEffect, useRef, useState} from "react";
import {useHubResource,useHubMutation} from "./api";
import {Field,Feedback,ResourceState,Badge} from "./shared";
export type InterviewHandoffReview={version:number;recommendation:string;notes:string;summary:string;recordingUrl:string;salaryExpectation:string;availability:string;concerns:string;readiness:{ready:boolean;missing:string[]};canApprove:boolean;returned?:{question:string;requestedBy:string;reviewVersion:number}|null};
export function WorkflowReview({id, resource, editing, onEdit, changed, onDirty}: {
 id: string; resource: ReturnType<typeof useHubResource<InterviewHandoffReview>>;
 editing: boolean; onEdit: (editing: boolean)=>void; changed:()=>void; onDirty?:(dirty:boolean)=>void;
}) {
 const review = resource.data;
 return <section className="hub-card hub-interview-review">
   <div className="hub-section-heading compact"><h3>Interview handoff</h3>
     {review?.readiness && <Badge tone={review.readiness.ready ? 'success' : 'warning'}>{review.readiness.ready ? 'Ready for decision' : 'Needs information'}</Badge>}
   </div>
   <ResourceState loading={resource.loading} error={resource.error} retry={()=>void resource.reload()}/>
   {review?.returned && <p className="hub-handoff-question"><strong>Requested by {review.returned.requestedBy}</strong><br/>{review.returned.question}</p>}
   {review?.readiness && !resource.loading && (editing
     ? <ReviewForm key={review.version} id={id} initial={review} onDirty={onDirty} cancelled={()=>onEdit(false)} saved={()=>{onEdit(false);void resource.reload();changed()}}/>
     : <HandoffSummary review={review} edit={()=>onEdit(true)}/>)}
 </section>;
}
function ReviewForm({id,initial,saved,onDirty,cancelled}:{id:string;initial:InterviewHandoffReview;saved:()=>void;onDirty?:(dirty:boolean)=>void;cancelled:()=>void}){
 const[v,set]=useState(initial),[dirty,setDirty]=useState(false),m=useHubMutation();
 const firstField = useRef<HTMLFormElement>(null);
 useEffect(() => {
   const fields=Array.from(firstField.current?.elements ?? []).filter((element): element is HTMLInputElement | HTMLTextAreaElement => element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement);
   const field=fields.find(element=>!element.value.trim()) ?? fields[0];
   field?.focus({preventScroll:true});
   field?.scrollIntoView({block:"nearest"});
 },[]);
 const update=(key:keyof InterviewHandoffReview,value:string)=>{set(old=>({...old,[key]:value}));setDirty(true);onDirty?.(true);};
 const required=[['recommendation','Recommendation'],['summary','Summary'],['notes','Interview notes'],['recordingUrl','Recording'],['salaryExpectation','Salary expectation'],['availability','Availability'],['concerns','Concerns or None']] as const;
 const missing=required.filter(([key])=>!v[key].trim()).map(([,label])=>label);
 return <form ref={firstField} className="hub-handoff-form" onSubmit={async e=>{e.preventDefault();const {recommendation,notes,summary,recordingUrl,salaryExpectation,availability,concerns}=v;const result=await m.run(`/api/hub/applications/${encodeURIComponent(id)}/recruiter-review`,"PUT",{expectedVersion:initial.version,recommendation,notes,summary,recordingUrl,salaryExpectation,availability,concerns},"Interview handoff saved.");if(result!==undefined){setDirty(false);onDirty?.(false);saved()}}}>
 <fieldset disabled={m.busy}><legend>Interview outcome</legend><div className="hub-review-grid"><Field label="Recommendation"><select value={v.recommendation} onChange={e=>update('recommendation',e.target.value)}><option value="">Choose a recommendation</option><option value="advance">Move forward</option><option value="hold">Discuss / hold</option><option value="reject">Do not move forward</option></select></Field><Field label="Call recording"><input value={v.recordingUrl} onChange={e=>update('recordingUrl',e.target.value)} placeholder="MeetGeek or an authorized recording link"/></Field></div><Field label="Interview summary"><textarea rows={3} maxLength={20000} value={v.summary} onChange={e=>update('summary',e.target.value)}/></Field><div className="hub-review-grid"><Field label="Interview notes"><textarea rows={3} maxLength={20000} value={v.notes} onChange={e=>update('notes',e.target.value)}/></Field><Field label="Outstanding concerns" hint="Write None when there are no outstanding concerns."><textarea rows={3} maxLength={10000} value={v.concerns} onChange={e=>update('concerns',e.target.value)}/></Field></div></fieldset>
 <fieldset disabled={m.busy}><legend>Practical details</legend><div className="hub-review-grid"><Field label="Salary expectation"><input value={v.salaryExpectation} onChange={e=>update('salaryExpectation',e.target.value)} placeholder="Amount, currency and pay period"/></Field><Field label="Availability"><input value={v.availability} onChange={e=>update('availability',e.target.value)} placeholder="Start date, hours and notice period"/></Field></div></fieldset>
 {missing.length>0&&<p className="hub-handoff-missing"><strong>Needed for founder review:</strong> {missing.join(' · ')}</p>}<Feedback error={m.error} success={m.success}/><div className="hub-handoff-footer"><button className="hub-button secondary" disabled={m.busy}>{m.busy?'Saving…':'Save handoff'}</button><button type="button" className="hub-text-button" disabled={m.busy} onClick={()=>{set(initial);setDirty(false);onDirty?.(false);cancelled()}}>{dirty?"Discard changes":"Cancel editing"}</button><small className="hub-muted">Saving does not send an email or move the applicant.</small></div>
 </form>;
}

/** Read mode keeps evidence scannable. Form controls mount only after an explicit edit. */
export function HandoffSummary({review,edit}:{review:InterviewHandoffReview;edit:()=>void}) {
 const recommendation=({advance:'Move forward',hold:'Discuss / hold',reject:'Do not move forward'} as Record<string,string>)[review.recommendation]||'No recommendation yet';
 const excerpt=review.summary.length>220?review.summary.slice(0,220).trimEnd()+'…':review.summary;
 return <div className="hub-handoff-summary"><div className="hub-handoff-read-actions"><strong>{recommendation}</strong><div className="hub-button-row">{review.recordingUrl&&<a className="hub-text-button" href={review.recordingUrl} target="_blank" rel="noopener noreferrer">Open call recording</a>}<button type="button" className="hub-button secondary" onClick={edit}>{review.readiness.ready?'Edit handoff':'Complete handoff'}</button></div></div>
 {(review.salaryExpectation||review.availability)&&<dl className="hub-handoff-facts">{review.salaryExpectation&&<div><dt>Salary expectation</dt><dd>{review.salaryExpectation}</dd></div>}{review.availability&&<div><dt>Availability</dt><dd>{review.availability}</dd></div>}</dl>}
 {excerpt&&<p className="hub-handoff-excerpt">{excerpt}</p>}
 {review.concerns&&<p className="hub-handoff-question"><strong>Outstanding concerns</strong><br/>{review.concerns}</p>}
 {(review.notes||review.summary.length>220)&&<details className="hub-handoff-feedback"><summary>Interview feedback</summary>{review.summary.length>220&&<div><h4>Full summary</h4><p className="hub-preserve">{review.summary}</p></div>}{review.notes&&<div><h4>Interview notes</h4><p className="hub-preserve">{review.notes}</p></div>}</details>}
 {!review.readiness.ready&&<p className="hub-handoff-missing"><strong>Needed for founder review:</strong> {review.readiness.missing.join(' · ')}</p>}</div>;
}
