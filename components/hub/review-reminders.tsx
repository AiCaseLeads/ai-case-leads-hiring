"use client";
import { NavigationLink, applicantHref } from "./navigation-link";
import { useState } from "react";
import { useHubMutation,useHubResource,displayDate } from "./api";
import { Badge,Feedback,Field,ResourceState } from "./shared";
type Config={enabled:boolean;dueHours:number;fallbackAdmins:string[]};
type Data={config:Config;staff:{email:string;role:string}[];total:number;offset:number;limit:number;applications:{id:string;name:string;jobTitle:string;assignee:string|null;stageEnteredAt:number}[]};
export function ReviewReminderSettings(){
  const resource=useHubResource<Data>("/api/review-reminders"),mutation=useHubMutation();
  const [draft,setDraft]=useState<Config|null>(null);
  const config=draft||resource.data?.config;
  function update(change:Partial<Config>){if(config)setDraft({...config,...change});}
  async function save(event:React.FormEvent){event.preventDefault();if(!config)return;const result=await mutation.run("/api/review-reminders","PATCH",config,"Review reminder settings saved.");if(result!==undefined){setDraft(null);await resource.reload();}}
  return <section className="hub-card" id="review-reminder-settings"><h3>Overdue review reminders</h3><p>The overview shows applicants still in initial review beyond the time limit. Optional daily emails follow each posting’s Hiring team & emails settings. For older postings without a saved hiring team, emails go to the assigned reviewer, with the selected managers covering unassigned applications or unavailable reviewers.</p>
    <ResourceState loading={resource.loading} error={resource.error} retry={()=>void resource.reload()}/>
    {config&&<form onSubmit={save}><Badge tone={config.enabled?"success":"neutral"}>{config.enabled?"Daily team emails enabled":"In-app queue only"}</Badge>
      <Field label="Remind after this many hours" hint="Time in New. Shortlist the applicant or move them to another stage to clear the reminder."><input type="number" min={1} max={720} required value={config.dueHours} onChange={e=>update({dueHours:Number(e.target.value)})}/></Field>
      <fieldset><legend>Fallback managers for older postings</legend>{resource.data?.staff.filter(s=>s.role==="admin").map(s=><label className="hub-checkbox" key={s.email}><input type="checkbox" checked={config.fallbackAdmins.includes(s.email)} onChange={e=>update({fallbackAdmins:e.target.checked?[...config.fallbackAdmins,s.email]:config.fallbackAdmins.filter(x=>x!==s.email)})}/>{s.email}</label>)}</fieldset>
      <label className="hub-checkbox"><input type="checkbox" checked={config.enabled} onChange={e=>update({enabled:e.target.checked})}/>Send daily overdue-review emails to the hiring team</label>
      <p className="hub-muted">At most one digest per person per day, using Bogotá time. Delivery requires automatic email setup and running background tasks. No candidate receives these emails. Shortlist the applicant or move them to the next stage to clear the reminder.</p>
      <button className="hub-button secondary" disabled={mutation.busy}>{mutation.busy?"Saving…":"Save review reminders"}</button><Feedback error={mutation.error} success={mutation.success}/>
    </form>}
  </section>;
}
export function ReviewReminderQueue({refresh=0,onSelect,compact=false}:{refresh?:number;onSelect:(id:string)=>void;compact?:boolean}){
  const [offset,setOffset]=useState(0),[scope,setScope]=useState(compact ? "mine" : "all"),[expanded,setExpanded]=useState(false);
  const resource=useHubResource<Data>(`/api/review-reminders?offset=${offset}&scope=${scope}`,refresh);
  const scopeLabel=scope==="mine"?"My overdue reviews":scope==="unassigned"?"Unassigned overdue reviews":"Team overdue reviews";
  return <section className="hub-card" id="overdue-reviews"><h3>{scopeLabel}</h3><p>Still in initial review after {resource.data?.config.dueHours??48} hours, without a recorded scorecard. This is not a count of new arrivals since your last login.</p>
    <Field label="Review queue"><select value={scope} onChange={e=>{setScope(e.target.value);setOffset(0);setExpanded(false);}}><option value="mine">Assigned to me</option><option value="all">All team applications</option><option value="unassigned">Unassigned</option></select></Field>
    <ResourceState loading={resource.loading} error={resource.error} retry={()=>void resource.reload()}/>
    {resource.data&&!resource.loading&&<><p><strong>{resource.data.total}</strong> overdue {resource.data.total===1?"review":"reviews"} · {scope==="mine"?"Assigned to you only":scope==="unassigned"?"No reviewer assigned":"Across the whole team"}</p>
      {resource.data.applications.length?<ul>{resource.data.applications.slice(0,compact && !expanded ? 5 : 50).map(a=><li key={a.id}><NavigationLink className="hub-button secondary" href={applicantHref(a.id)} navigate={()=>onSelect(a.id)}>{a.name} · {a.jobTitle}</NavigationLink><span className="hub-muted"> {a.assignee||"Unassigned"} · Waiting since {displayDate(a.stageEnteredAt)}</span></li>)}</ul>:<p>No overdue reviews in this queue.</p>}
      {compact && resource.data.applications.length > 5 && <button className="hub-text-button" onClick={() => setExpanded(value => !value)}>{expanded ? "Show fewer" : "Show more waiting applicants"}</button>}
      {resource.data.total > 50 && (!compact || expanded) && <div className="hub-actions"><button className="hub-button secondary" disabled={!offset} onClick={()=>setOffset(Math.max(0,offset-50))}>Previous reviews</button><button className="hub-button secondary" disabled={offset+50>=resource.data.total} onClick={()=>setOffset(offset+50)}>Next reviews</button></div>}
    </>}
  </section>;
}
