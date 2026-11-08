import type { ReactNode } from "react";
import { contactPaths, isLinkedInProfile } from "@/lib/hiring/contact-fields";
import type { ApplicationDetail } from "./types";
import { displayAnswer } from "./api";

export function answerContactName(detail:Pick<ApplicationDetail,"name"|"email"|"answers"|"fields">) {
 const read=(path:string)=>String(detail.answers.find(answer=>answer.path===path)?.value||"").trim();
 const first=read(contactPaths[0]),last=read(contactPaths[1]);
 if(!first)return detail.name||last||"Unnamed applicant";
 return !last||first.toLocaleLowerCase().endsWith(` ${last.toLocaleLowerCase()}`)||first.toLocaleLowerCase()===last.toLocaleLowerCase()?first:`${first} ${last}`;
}
function linkedText(text:string):ReactNode {
 const parts:ReactNode[]=[];const pattern=/https?:\/\/[^\s<>"']+/gi;let cursor=0;
 for(const match of text.matchAll(pattern)) {
  const raw=match[0],start=match.index!;
  // Do not extract an apparently safe URL out of another URI scheme.
  if(start>0&&!/[\s([{"']/.test(text[start-1]))continue;
  let url=raw.replace(/[.,;!?]+$/g,"");
  for(const [open,close] of [["(",")"],["[","]"],["{","}"]])while(url.endsWith(close)&&url.split(close).length>url.split(open).length)url=url.slice(0,-1);
  url=url.replace(/[.,;!?]+$/g,"");
  let safe=false;try{safe=["http:","https:"].includes(new URL(url).protocol);}catch{}
  if(!safe)continue;
  parts.push(text.slice(cursor,start),<a key={start} href={url} target="_blank" rel="noopener noreferrer">{url}</a>);cursor=start+url.length;
 }
 parts.push(text.slice(cursor));return parts;
}
export type AnswerDetail = Pick<ApplicationDetail,"name"|"email"|"answers"|"fields">;
export function ApplicationAnswers({detail,renderAnswerCheck}:{detail:AnswerDetail;renderAnswerCheck?:(path:string)=>ReactNode}) {
 const read=(path:string)=>String(detail.answers.find(answer=>answer.path===path)?.value||"").trim();
 const email=read(contactPaths[2])||detail.email,phone=read(contactPaths[3]);
 const phoneHref=/^\+?[\d ()-]+$/.test(phone)?`tel:${phone.replace(/[ ()-]/g,"")}`:null;
 const linkedIn=detail.answers.filter(answer=>detail.fields.some(field=>field.path===answer.path&&isLinkedInProfile(field)));
 const answers=detail.answers.filter(answer=>!linkedIn.includes(answer)&&!contactPaths.includes(answer.path)&&detail.fields.find(field=>field.path===answer.path)?.type!=="File");
 return <div className="hub-application-answers">
  <dl className="hub-contact-strip" aria-label="Applicant contact details"><div><dt>Name</dt><dd>{answerContactName(detail)}</dd></div><div><dt>Email</dt><dd>{email?<a href={`mailto:${encodeURIComponent(email)}`}>{email}</a>:"Not provided"}</dd></div><div><dt>Phone</dt><dd>{phoneHref?<a href={phoneHref}>{phone}</a>:phone||"Not provided"}</dd></div><div><dt>LinkedIn</dt><dd>{linkedIn.length?linkedIn.map(answer=><div key={answer.path}>{linkedText(displayAnswer(answer.value))}</div>):"Not provided"}</dd></div></dl>
  {answers.length?<dl className="hub-answer-list hub-compact-answers">{answers.map(answer=>{
   const field=detail.fields.find(field=>field.path===answer.path);
   const value=field?.type==="Number"&&typeof answer.value==="number"?new Intl.NumberFormat("en-US",field.numberFormat==="currency"?{style:"currency",currency:field.currency||"USD"}:{}).format(answer.value):field?.options?(Array.isArray(answer.value)?answer.value:[answer.value]).map(value=>field.options?.find(option=>option.value===value)?.label||displayAnswer(value)).join(", "):displayAnswer(answer.value);
   const long=field?.type==="LongText"||value.length>180||value.includes("\n");
   return <div key={answer.path} className={long?"hub-answer-long":"hub-answer-short"}><dt>{field?.title||answer.path}</dt><dd><span>{linkedText(value)}</span>{renderAnswerCheck?.(answer.path)}</dd></div>;
  })}</dl>:<p className="hub-muted">No additional application answers.</p>}
 </div>;
}
