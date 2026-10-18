"use client";
import { useEffect, useRef, useState } from "react";
import { hubRequest, useHubResource } from "./api";
import type { ApplicationDetail, HubJob } from "./types";
export function ApplicantNavigation({detail,filter,jobs,open,viewed}:{detail:ApplicationDetail;filter:string;jobs:HubJob[];open:(id:string,filter:string)=>void;viewed:()=>void}) {
  const params=new URLSearchParams(filter);
  if(!params.has("jobId"))params.set("jobId",detail.jobId);
  if(!params.has("sort"))params.set("sort",jobs.find(job=>job.id===detail.jobId)?.aiMatchEnabled?"ai_match_desc":"newest");
  params.delete("page");
  const query=params.toString();
  const neighbors=useHubResource<{previousId:string|null;nextId:string|null;position:number;total:number}>(`/api/hub/applications/${encodeURIComponent(detail.id)}/navigation?${query}`);
  const [viewError,setViewError]=useState("");
  const [marked,setMarked]=useState(!!detail.viewedAt);
  const started=useRef(false);
  const onViewed=useRef(viewed);useEffect(()=>{onViewed.current=viewed;},[viewed]);
  async function markViewed(){
    setViewError("");
    try{await hubRequest(`/api/hub/applications/${encodeURIComponent(detail.id)}/viewed`,"POST",{});setMarked(true);onViewed.current();}
    catch{setViewError("Your viewed status could not be saved. You can still review this application.");}
  }
  useEffect(()=>{if(started.current || detail.viewedAt)return;started.current=true;void markViewed();},[detail.id,detail.viewedAt]); // eslint-disable-line react-hooks/exhaustive-deps
  return <div className="hub-review-navigation">
    <div className="hub-button-row" aria-label="Browse matching applicants">
      <button type="button" className="hub-button secondary" disabled={neighbors.loading || !neighbors.data?.previousId} onClick={()=>neighbors.data?.previousId && open(neighbors.data.previousId,query)}>Previous applicant</button>
      <span role="status">{neighbors.loading?"Finding applicant position…":neighbors.data?`Applicant ${neighbors.data.position} of ${neighbors.data.total} matching results`:"Applicant order unavailable"}</span>
      <button type="button" className="hub-button secondary" disabled={neighbors.loading || !neighbors.data?.nextId} onClick={()=>neighbors.data?.nextId && open(neighbors.data.nextId,query)}>Next applicant</button>
      <span className="hub-muted">{marked?"Viewed by you":"New to you"}</span>
    </div>
    {neighbors.error && <p className="hub-muted">The matching list may have changed. Return to applications to refresh your filters.</p>}
    {viewError && <p role="status">{viewError} <button type="button" className="hub-text-button" onClick={()=>void markViewed()}>Retry viewed status</button></p>}
  </div>;
}
export function resumeFile(detail:ApplicationDetail){
  const fields=detail.fields.filter(field=>field.type==="File" && (field.path==="_systemfield_resume" || /\b(resume|résumé|cv|curriculum vitae)\b/i.test(field.title)));
  fields.sort((a,b)=>Number(b.path==="_systemfield_resume")-Number(a.path==="_systemfield_resume"));
  for(const field of fields){const file=detail.files.find(file=>file.fieldPath===field.path);if(file)return file;}
  return undefined;
}
export function ResumePreview({detail}:{detail:ApplicationDetail}){
  const resume=resumeFile(detail);
  if(!resume)return null;
  return <FilePreview file={resume}/>;
}
function FilePreview({file:resume}:{file:ApplicationDetail["files"][number]}) {
  const previewable=resume.contentType==="application/pdf" || ["image/png","image/jpeg","image/webp"].includes(resume.contentType);
  const url=`/api/files/${encodeURIComponent(resume.id)}?preview=1`;
  const [ready,setReady]=useState(false);
  const [error,setError]=useState(false);
  useEffect(()=>{if(!previewable)return;const controller=new AbortController();void fetch(url,{method:"HEAD",credentials:"same-origin",signal:controller.signal}).then(response=>{if(!response.ok || !["application/pdf","image/png","image/jpeg","image/webp"].includes((response.headers.get("content-type") || "").split(";")[0].trim()))throw Error("preview unavailable");setReady(true);}).catch(()=>{if(!controller.signal.aborted)setError(true);});return()=>controller.abort();},[url,previewable]);
  return <section className="hub-card hub-resume-preview" aria-label="Résumé preview">
    <div className="hub-section-heading compact"><div><h3>Résumé</h3><p className="hub-muted" style={{overflowWrap:"anywhere"}}>{resume.filename}</p></div><a className="hub-button secondary" href={resume.url} target="_blank" rel="noopener noreferrer">Download résumé</a></div>
    {previewable && ready ? <><iframe title={`Résumé preview: ${resume.filename}`} src={url} style={{display:"block",width:"100%",height:"min(65vh,700px)",minHeight:280,border:"1px solid #d7e3e1",borderRadius:8}}/><p className="hub-muted">If your browser cannot display this file, use Download résumé.</p></> : previewable ? <p role="status">{error?"Preview is unavailable. Use Download résumé or refresh to retry.":"Loading résumé preview…"}</p> : <p className="hub-muted">This file format cannot be previewed here. Download the original résumé to open it.</p>}
  </section>;
}
