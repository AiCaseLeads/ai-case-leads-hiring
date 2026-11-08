"use client";
import {useId,useState} from "react";
import type {ApplicantCollection} from "../../lib/hub/applicant-collections";
import type {ListReviewDetail, ReviewInbox, ReviewItem} from "../../lib/hub/list-reviews";
import {useHubMutation,useHubResource} from "./api";
import {NavigationLink} from "./navigation-link";
import {stageLabel} from "./types";

const endpoint="/api/hub/list-reviews";
export function RequestListReview({list,ids,close}:{
  list:ApplicantCollection;ids?:string[];close:()=>void;
}) {
  const staff=useHubResource<string[]>(endpoint+"/reviewers");
  const action=useHubMutation();
  const [reviewer,setReviewer]=useState(""),[prompt,setPrompt]=useState("");
  const [requestId]=useState(()=>crypto.randomUUID());
  const count=ids?.length ?? list.size, ready=count>0 && count<=100;
  return <section className="collection-panel" aria-label="Request feedback">
    <h3>Request feedback on {list.name}</h3>
    {!action.success ? <form className="collection-editor" onSubmit={async event=>{
      event.preventDefault();
      await action.run(endpoint,"POST",{action:"request",requestId,listId:list.id,revision:list.revision,reviewer,prompt,...(ids?{ids}:{})},
        `Review requested from ${reviewer}. Track feedback in Home → List reviews → Sent.`);
    }}>
      <p>{count} {count===1?"application":"applications"} · Membership is fixed for this review.</p>
      {!ready && <p role="alert">Choose between 1 and 100 applications from this list.</p>}
      <div className="collection-controls"><label>Reviewer<select required disabled={action.busy} value={reviewer} onChange={e=>setReviewer(e.target.value)}>
        <option value="">Choose a teammate</option>{(Array.isArray(staff.data)?staff.data:[]).map(email=><option key={email} value={email}>{email}</option>)}
      </select></label><label>Question for reviewer (optional)<input maxLength={1000} value={prompt} disabled={action.busy} onChange={e=>setPrompt(e.target.value)} placeholder="What would you like feedback on?"/></label></div>
      {staff.error && <p role="alert">{staff.error} <button type="button" className="hub-text-button" onClick={staff.reload}>Retry</button></p>}
      <div className="collection-actions"><button className="hub-button" disabled={!ready || !reviewer || action.busy} type="submit">Request review</button>
      <button className="hub-text-button" disabled={action.busy} type="button" onClick={close}>Cancel</button></div>
    </form> : <><p role="status">{action.success}</p><button type="button" className="hub-text-button" onClick={close}>Done</button></>}
    {action.error && <p role="alert">{action.error}</p>}
  </section>;
}

type OpenApplicant = (id:string,listId:string)=>void;
function FeedbackItem({item,listId,id,canRespond,onOpen,onSaved}:{
  item:ReviewItem;listId:string;id:string;canRespond:boolean;onOpen?:OpenApplicant;onSaved:()=>void;
}) {
  const action=useHubMutation(),[feedback,setFeedback]=useState("");
  const href="/team?"+new URLSearchParams({view:"applications",application:item.applicationId,listId,active:"false",sort:"list_order"});
  return <article>
    <div className="collection-heading"><h4>{onOpen ? <NavigationLink className="hub-text-button" href={href} navigate={()=>onOpen(item.applicationId,listId)}>{item.name}</NavigationLink> : <a className="hub-text-button" href={href}>{item.name}</a>}</h4>
    <span>{item.reviewedAt?"Reviewed":"Awaiting review"}</span></div>
    <p>{item.jobTitle} · {stageLabel(item.stage)}</p>
    {item.reviewedAt && <p className="collection-feedback">{item.feedback || "Reviewed without a comment."}</p>}
    {!item.reviewedAt && canRespond && <form onSubmit={async event=>{
      event.preventDefault();
      const result=await action.run(endpoint,"POST",{action:"review",requestId:id,applicationId:item.applicationId,feedback});
      if(result) onSaved();
    }}>
      <label>Internal feedback (optional)<textarea rows={2} maxLength={4000} value={feedback} onChange={e=>setFeedback(e.target.value)}/></label>
      <button type="submit" className="hub-button secondary" disabled={action.busy}>Mark reviewed</button>
    </form>}
    {action.error && <p role="alert">{action.error}</p>}
  </article>;
}
function ReviewDetail({id,onOpen,onSaved,close}: {id:string;onOpen?:OpenApplicant;onSaved:()=>void;close:()=>void}) {
  const result=useHubResource<ListReviewDetail>(endpoint+"/"+encodeURIComponent(id)),detail=result.data;
  return <div aria-label="Review request" className="collection-panel">
    <button type="button" className="hub-text-button" onClick={close}>Back to review requests</button>
    {result.error && <p role="alert">{result.error}</p>}
    {detail?.summary && <><h3>{detail.summary.name}</h3>
      <p>Requested by {detail.summary.requester} · Reviewer {detail.summary.reviewer}</p>
      {detail.summary.prompt && <p>{detail.summary.prompt}</p>}
      <div className="collection-cards">{detail.items.map(item=><FeedbackItem item={item} key={item.applicationId} id={id}
        listId={detail.summary.listId} canRespond={detail.canRespond} onOpen={onOpen} onSaved={()=>{void result.reload();onSaved();}}/>)}</div>
    </>}
  </div>;
}

export function ListReviewInbox({onOpenApplication}:{onOpenApplication?:OpenApplicant}) {
  const [box,setBox]=useState("received"),[status,setStatus]=useState("open"),[page,setPage]=useState(1);
  const [detail,setDetail]=useState(""),[expanded,setExpanded]=useState(false);
  const region=useId();
  const result=useHubResource<ReviewInbox>(endpoint+"?"+new URLSearchParams({box,status,page:String(page)}));
  const inbox=result.data;
  return <section className="hub-card hub-review-inbox">
    <button className="hub-text-button" type="button" aria-controls={region} aria-expanded={expanded} onClick={()=>setExpanded(!expanded)}>
      List reviews{typeof inbox?.total==="number" && box==="received" && status==="open" ? ` · ${inbox.total} awaiting you`:""}
    </button>
    {expanded && <div id={region}>
      {detail ? <ReviewDetail id={detail} onOpen={onOpenApplication} close={()=>setDetail("")} onSaved={()=>void result.reload()}/> : <>
        <div className="collection-controls"><label>Requests<select value={box} onChange={e=>{setBox(e.target.value);setPage(1);}}>
          <option value="received">Assigned to me</option><option value="sent">Sent by me</option>
        </select></label><label>Review status<select value={status} onChange={e=>{setStatus(e.target.value);setPage(1);}}>
          <option value="open">Outstanding</option><option value="completed">Completed</option>
        </select></label></div>
        {result.error && <p role="alert">{result.error} <button className="hub-text-button" type="button" onClick={result.reload}>Retry</button></p>}
        {result.loading && <p role="status">Loading requests…</p>}
        {!result.loading && inbox?.items?.length===0 && <p>No {status==="open"?"outstanding":"completed"} requests.</p>}
        {!result.loading && inbox?.items?.map(row=><button key={row.id} type="button" className="collection-review-row" onClick={()=>setDetail(row.id)}>
          <strong>{row.name}</strong><span>{box==="sent"?row.reviewer:row.requester} · {row.completed} of {row.total} reviewed</span>
        </button>)}
        {(page>1 || (inbox?.total || 0)>page*10) && <div className="collection-actions"><button type="button" disabled={page<=1} onClick={()=>setPage(p=>p-1)}>Previous</button><span>Page {page}</span><button type="button" disabled={(inbox?.total || 0)<=page*10} onClick={()=>setPage(p=>p+1)}>Next</button></div>}
      </>}
    </div>}
  </section>;
}
