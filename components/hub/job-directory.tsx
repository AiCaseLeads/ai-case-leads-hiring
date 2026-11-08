"use client";
import { useState, type ReactNode } from "react";
import type { HubJob } from "./types";
import type { JobGroup, JobGroupCatalog } from "@/lib/hub/job-groups";
import { countryOptions } from "@/lib/countries";
import { postingLocationCountries } from "@/lib/hiring/posting-countries";
import { useHubMutation, useHubResource } from "./api";
import { Feedback, Field, ResourceState } from "./shared";

type Kind = JobGroup["kind"];
type Draft = { id?: string; kind: Kind; name: string; jobIds: string[]; expectedRevision: number };
type GroupMode = "role" | "department" | "location";
type Counts = {items: {jobId:string; total:number}[]};

function suggestedRoles(jobs: HubJob[], groups: JobGroup[]) {
  const claimed = new Set(groups.filter(g=>g.kind==="role").flatMap(g=>g.jobIds));
  const matches = new Map<string,{name:string; jobIds:string[]}>();
  for (const job of jobs) {
    if (claimed.has(job.id) || (job.lifecycle?.state || "active") !== "active") continue;
    const suffix = /^(.+?)\s+[—–-]\s+(.+)$/.exec(job.title);
    const countries = suffix && postingLocationCountries(suffix[2]);
    const name = job.archiveProject?.trim() && job.archiveProject.trim()!==job.title
      ? job.archiveProject.trim() : suffix && countries?.length ? suffix[1].trim() : job.title.trim();
    const key = name.toLowerCase();
    const match = matches.get(key) || {name,jobIds:[]};
    match.jobIds.push(job.id);
    matches.set(key,match);
  }
  return [...matches.values()].filter(match=>match.jobIds.length>1);
}

export function JobDirectory({jobs,filtered,admin,refresh,controls,renderPosting}: {
  jobs:HubJob[]; filtered:HubJob[]; admin:boolean; refresh:number;
  controls: ReactNode;
  renderPosting:(job:HubJob, applications?:number)=>ReactNode;
}) {
  const catalog = useHubResource<JobGroupCatalog>("/api/hub/job-groups",refresh);
  const counts = useHubResource<Counts>("/api/hub/application-counts",refresh);
  const mutation = useHubMutation();
  const [mode,setMode] = useState<GroupMode>("role");
  const [folder,setFolder] = useState("");
  const [organize,setOrganize] = useState(false);
  const [draft,setDraft] = useState<Draft|null>(null);
  const [term,setTerm] = useState("");
  const [deleting,setDeleting] = useState(false);
  const [message,setMessage] = useState("");
  const groups = catalog.data?.groups ?? [];
  const folders=groups.filter(g=>g.kind==="folder");
  const folderGroup=folders.find(g=>g.id===folder);
  const visible=filtered.filter(job=>!folderGroup || folderGroup.jobIds.includes(job.id));
  const membership=new Map(groups.filter(g=>g.kind==="role").flatMap(g=>g.jobIds.map(id=>[id,g] as const)));
  const totals=new Map(counts.data?.items?.map(x=>[x.jobId,x.total]) ?? []);
  const familyHref=(id:string)=>"/team?view=applications&active=false&jobGroupId="+encodeURIComponent(id);
  const appCount=(ids:string[])=>counts.data ? ids.reduce((n,id)=>n+(totals.get(id)||0),0) : null;
  const sections=new Map<string,{title:string;group?:JobGroup;jobs:HubJob[]}>();
  for (const job of visible) {
    const group = mode==="role" ? membership.get(job.id) : undefined;
    let titles: string[];
    if (mode === "location") {
      const countries = postingLocationCountries(job.location || job.archiveCountry);
      titles = countries === "worldwide" ? ["Worldwide"] : countries.length
        ? countries.map(code=>countryOptions.find(option=>option.value===code)?.label || code)
        : [job.location || job.archiveCountry || "Location unspecified"];
    } else {
      titles = [mode === "role" ? group?.name || job.title : job.department || "No department"];
    }
    for (const title of titles) {
      const key = mode==="role" ? group?.id || job.id : title;
      const bucket = sections.get(key) || {title,group,jobs:[]};
      bucket.jobs.push(job); sections.set(key,bucket);
    }
  }
  function edit(value:Pick<Draft,"kind"|"name"|"jobIds"> & {id?:string}) {
    if (!catalog.data) return;
    mutation.clear(); setMessage(""); setTerm(""); setDeleting(false);
    setDraft({id:value.id,kind:value.kind,name:value.name,jobIds:value.jobIds,expectedRevision:catalog.data.revision}); setOrganize(true);
  }
  async function save(remove=false) {
    if (!draft) return;
    const body=remove ? {action:"delete",id:draft.id,expectedRevision:draft.expectedRevision}
      : {...draft, name:draft.name.trim(), action:"save"};
    const updated=await mutation.run<JobGroupCatalog>("/api/hub/job-groups","POST",body);
    if (!updated) return;
    if (remove && folder===draft.id) setFolder("");
    setDraft(null);setDeleting(false);setOrganize(false);setMessage(remove?"Group removed. Its postings are still available.":"Posting group saved.");
    await catalog.reload();
  }
  function startManaging() { setOrganize(!organize);setDraft(null);setMessage("");mutation.clear(); }
  const suggestions=suggestedRoles(jobs,groups);
  return <div className="role-directory">
    <div className="role-directory-tools">
      {controls}
      <Field label="Group postings by"><select value={mode} onChange={e=>setMode(e.target.value as GroupMode)}>
        <option value="role">Role</option><option value="department">Department</option><option value="location">Country / location</option>
      </select></Field>
      {folders.length>0 && <Field label="Job folder"><select value={folderGroup?.id||""} onChange={e=>setFolder(e.target.value)}>
        <option value="">All postings</option>{folders.map(g=><option key={g.id} value={g.id}>{g.name}</option>)}</select></Field>}
      {admin && <button className="hub-button secondary" type="button" aria-expanded={organize} onClick={startManaging}>Organize postings</button>}
    </div>
    {catalog.error && <ResourceState loading={false} error={catalog.error} retry={()=>void catalog.reload()}/>}
    {counts.error && <ResourceState loading={false} error={counts.error} retry={()=>void counts.reload()}/>}
    {message && <p role="status">{message}</p>}
    {organize && admin && <section className="role-editor" aria-label="Organize postings">
      {draft ? <form onSubmit={e=>{e.preventDefault();void save()}}>
        <h3>{draft.id?"Edit":"New"} {draft.kind==="role"?"role group":"job folder"}</h3>
        <Field label={draft.kind==="role"?"Role group name":"Folder name"}><input autoFocus value={draft.name} required maxLength={100} onChange={e=>setDraft({...draft,name:e.target.value})}/></Field>
        <Field label="Find postings to include"><input type="search" value={term} onChange={e=>setTerm(e.target.value)}/></Field>
        <fieldset className="role-job-options"><legend>Included postings ({draft.jobIds.length})</legend>
          {jobs.filter(j=>[j.title,j.location].join(" ").toLowerCase().includes(term.trim().toLowerCase())).map(j=>{
            const existing=membership.get(j.id);
            const locked=draft.kind==="role" && !!existing && existing.id!==draft.id;
            return <label key={j.id}><input type="checkbox" disabled={locked} checked={draft.jobIds.includes(j.id)} onChange={e=>setDraft({...draft,jobIds:e.target.checked?[...draft.jobIds,j.id]:draft.jobIds.filter(id=>id!==j.id)})}/><span>{j.title}<small>{[j.location||"Location unspecified",j.lifecycle?.state!=="active" && j.lifecycle?.state,locked && existing?.name].filter(Boolean).join(" · ")}</small></span></label>;
          })}
        </fieldset>
        <Feedback error={mutation.error}/>
        {mutation.error && <button type="button" className="hub-text-button" onClick={async()=>{await catalog.reload();setDraft(null);mutation.clear();}}>Reload groups</button>}
        <div className="role-editor-actions"><button className="hub-button" type="submit" disabled={mutation.busy||!draft.name.trim()}>Save group</button>
          <button className="hub-text-button" type="button" disabled={mutation.busy} onClick={()=>setDraft(null)}>Cancel</button>
          {draft.id&&!deleting&&<button className="hub-text-button" type="button" onClick={()=>setDeleting(true)}>Remove group</button>}</div>
        {deleting&&<div><p>Remove this group and keep its postings?</p><button className="hub-button secondary" type="button" disabled={mutation.busy} onClick={()=>void save(true)}>Confirm removal</button></div>}
      </form> : <>
        <div className="role-editor-actions"><button type="button" className="hub-button secondary" onClick={()=>edit({kind:"role",name:"",jobIds:[]})}>Create role group</button>
          <button type="button" className="hub-button secondary" onClick={()=>edit({kind:"folder",name:"",jobIds:[]})}>Create job folder</button></div>
        <p className="hub-muted">Each posting can have one parent role and belong to several folders.</p>
        {groups.length>0 && <ul>{groups.map(g=><li key={g.id}><button className="hub-text-button" type="button" onClick={()=>edit(g)}>{g.name}</button> · {g.kind==="role"?"Role":"Folder"} · {g.jobIds.length} postings</li>)}</ul>}
        {suggestions.length>0 && <details><summary>Suggested role groups ({suggestions.length})</summary>{suggestions.map(g=><div className="role-suggestion" key={g.name}><span>{g.name} · {g.jobIds.length} postings</span><button className="hub-text-button" type="button" onClick={()=>edit({...g,kind:"role"})}>Review group</button></div>)}</details>}
      </>}
    </section>}
    {folderGroup && <a className="hub-object-link" href={familyHref(folderGroup.id)}>All applicants in {folderGroup.name}{counts.data ? ` (${appCount(folderGroup.jobIds)})`:""}</a>}
    {!visible.length && folderGroup && <p>No matching postings in this folder.</p>}
    <div className="hub-job-list">
      {[...sections.entries()].map(([key,b])=>mode==="role"&&!b.group
        ? renderPosting(b.jobs[0],totals.get(b.jobs[0].id))
        : <div key={key} className="role-family">
            <details><summary><strong>{b.title}</strong> <span>{b.jobs.length} {b.jobs.length===1?"posting":"postings"}</span></summary>
              {b.jobs.map(j=>renderPosting(j,totals.get(j.id)))}</details>
            {b.group && <a className="role-family-applicants hub-object-link" href={familyHref(b.group.id)} aria-label={`View all applicants for ${b.group.name}`}>{counts.data ? `${appCount(b.group.jobIds)} applicants` : "View applicants"}</a>}
          </div>)}
    </div>
  </div>;
}
