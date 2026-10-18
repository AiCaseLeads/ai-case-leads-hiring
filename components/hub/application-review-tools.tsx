"use client";
/* eslint-disable @next/next/no-img-element -- Authenticated résumé images must load directly without an image proxy. */
import { useEffect, useRef, useState } from "react";
import { PdfPreview } from "./pdf-preview";
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
  const word=["application/msword","application/vnd.openxmlformats-officedocument.wordprocessingml.document"].includes(resume.contentType) || /\.docx?$/i.test(resume.filename);
  const previewable=word || resume.contentType==="application/pdf" || ["image/png","image/jpeg","image/webp"].includes(resume.contentType);
  const url=`/api/files/${encodeURIComponent(resume.id)}?preview=1`;
  const [ready,setReady]=useState(false);
  const [expanded,setExpanded]=useState(false);
  const [error,setError]=useState(false);
  useEffect(()=>{if(!previewable)return;const controller=new AbortController();void fetch(url,{method:"HEAD",credentials:"same-origin",signal:controller.signal}).then(response=>{if(!response.ok || !["application/pdf","image/png","image/jpeg","image/webp","text/plain"].includes((response.headers.get("content-type") || "").split(";")[0].trim()))throw Error("preview unavailable");setReady(true);}).catch(()=>{if(!controller.signal.aborted)setError(true);});return()=>controller.abort();},[url,previewable]);
  return <section className={"hub-resume-preview"+(expanded?" is-expanded":"")} aria-label="Résumé preview">
    {previewable && <button type="button" className="hub-text-button" aria-expanded={expanded} onClick={()=>setExpanded(value=>!value)}>{expanded?"Compact preview":"Enlarge preview"}</button>}
    {previewable && ready && !error ? (word ? <WordPreview key={url} url={url}/> : resume.contentType==="application/pdf" ? <PdfPreview key={url} url={url} filename={resume.filename}/> : <img src={url} onError={()=>setError(true)} alt={`Résumé: ${resume.filename}`} style={{display:"block",maxWidth:"100%",maxHeight:expanded?"min(70vh,700px)":"280px",objectFit:"contain",margin:"0 auto"}}/>) : previewable ? <p role="status">{error?"Preview is unavailable. Use the Download link above or refresh to retry.":"Loading résumé preview…"}</p> : <p className="hub-muted">This file format cannot be previewed here. Use the Download link above to open the original résumé.</p>}
  </section>;
}

function WordPreview({url}:{url:string}) {
  const [text,setText]=useState<string|null>(null),[error,setError]=useState(false),[truncated,setTruncated]=useState(false);
  useEffect(()=>{const controller=new AbortController();void fetch(url,{credentials:"same-origin",cache:"no-store",signal:controller.signal}).then(async response=>{if(!response.ok || !(response.headers.get("content-type") || "").startsWith("text/plain"))throw Error("preview unavailable");const value=await response.text();if(!value.trim())throw Error("empty preview");if(!controller.signal.aborted){setText(value);setTruncated(response.headers.get("X-Preview-Truncated")==="true");}}).catch(()=>{if(!controller.signal.aborted)setError(true);});return()=>controller.abort();},[url]);
  return <div><h5>Word résumé · text preview</h5><p className="hub-muted">Formatting may differ. Download the original for the complete document.</p>{truncated && <p role="status">Preview shortened. Download the original for the full résumé.</p>}{error?<p role="status">Preview is unavailable. Use the Download link above to open the original résumé.</p>:text===null?<p role="status">Loading résumé text…</p>:<div className="hub-resume-canvas-window" role="region" aria-label="Word résumé text" tabIndex={0} style={{overflow:"auto",whiteSpace:"pre-wrap",overflowWrap:"anywhere",padding:12,background:"white"}}>{text}</div>}</div>;
}
