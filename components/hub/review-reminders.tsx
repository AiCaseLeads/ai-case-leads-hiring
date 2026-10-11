"use client";
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
  return <section className="hub-card" id="review-reminder-settings"><h3>Overdue human reviews</h3><p>The overview always shows applications waiting for an initial human review. Optional daily emails go to the assigned team member; selected managers cover unassigned applications or unavailable assignees.</p>
    <ResourceState loading={resource.loading} error={resource.error} retry={()=>void resource.reload()}/>
    {config&&<form onSubmit={save}><Badge tone={config.enabled?"success":"neutral"}>{config.enabled?"Daily team emails enabled":"In-app queue only"}</Badge>
      <Field label="Remind after this many hours" hint="Measured from entry into Application Review. Saving notes or running AI does not count as a completed review."><input type="number" min={1} max={720} required value={config.dueHours} onChange={e=>update({dueHours:Number(e.target.value)})}/></Field>
      <fieldset><legend>Managers for unassigned applications</legend>{resource.data?.staff.filter(s=>s.role==="admin").map(s=><label className="hub-checkbox" key={s.email}><input type="checkbox" checked={config.fallbackAdmins.includes(s.email)} onChange={e=>update({fallbackAdmins:e.target.checked?[...config.fallbackAdmins,s.email]:config.fallbackAdmins.filter(x=>x!==s.email)})}/>{s.email}</label>)}</fieldset>
      <label className="hub-checkbox"><input type="checkbox" checked={config.enabled} onChange={e=>update({enabled:e.target.checked})}/>Send daily overdue-review emails to the hiring team</label>
      <p className="hub-muted">At most one digest per person per day, using Bogotá time. Delivery requires the connected Gmail account and running background tasks. No candidate receives these emails. Record a scorecard or move the application to its next stage to clear it.</p>
      <button className="hub-button secondary" disabled={mutation.busy}>{mutation.busy?"Saving…":"Save review reminders"}</button><Feedback error={mutation.error} success={mutation.success}/>
    </form>}
  </section>;
}
export function ReviewReminderQueue({refresh=0,onSelect}:{refresh?:number;onSelect:(id:string)=>void}){
  const [offset,setOffset]=useState(0),[scope,setScope]=useState("all");
  const resource=useHubResource<Data>(`/api/review-reminders?offset=${offset}&scope=${scope}`,refresh);
  return <section className="hub-card" id="overdue-reviews"><h3>Overdue human reviews</h3><p>Applications in Application Review without a scorecard for {resource.data?.config.dueHours??48} hours or more.</p>
    <Field label="Show overdue applications"><select value={scope} onChange={e=>{setScope(e.target.value);setOffset(0);}}><option value="all">All team applications</option><option value="mine">Assigned to me</option><option value="unassigned">Unassigned</option></select></Field>
    <ResourceState loading={resource.loading} error={resource.error} retry={()=>void resource.reload()}/>
    {resource.data&&!resource.loading&&<><p><strong>{resource.data.total}</strong> awaiting human review</p>
      {resource.data.applications.length?<ul>{resource.data.applications.map(a=><li key={a.id}><button className="hub-button secondary" onClick={()=>onSelect(a.id)}>{a.name} · {a.jobTitle}</button><span className="hub-muted"> {a.assignee||"Unassigned"} · Waiting since {displayDate(a.stageEnteredAt)}</span></li>)}</ul>:<p>No applications match this overdue queue.</p>}
      <div className="hub-actions"><button className="hub-button secondary" disabled={!offset} onClick={()=>setOffset(Math.max(0,offset-50))}>Previous reviews</button><button className="hub-button secondary" disabled={offset+50>=resource.data.total} onClick={()=>setOffset(offset+50)}>Next reviews</button></div>
    </>}
  </section>;
}
