"use client";
import { useId, useState } from "react";
import { Bookmark, ListPlus, Link as LinkIcon, X } from "lucide-react";
import type { ApplicantCollection, ComparedApplication } from "../../lib/hub/applicant-collections";
import { hubRequest, useHubMutation, useHubResource } from "./api";
import { RequestListReview } from "./list-review-inbox";
import { stageLabel } from "./types";

const endpoint = "/api/hub/collections";
type Kind = ApplicantCollection["kind"];
type Scope = ApplicantCollection["visibility"];
type Props = {
  filter: string;
  onApply: (filter:string) => void;
  selectedIds: string[];
  allMatching: boolean;
  selectionId?: string;
  disabled: boolean;
  onChanged?: () => void;
};
function listQuery(id: string) {
  return new URLSearchParams({listId:id,active:"false",sort:"list_order"}).toString();
}
function viewQuery(filter: string) {
  const params=new URLSearchParams(filter);
  for (const key of ["view","application","page","format","check"]) params.delete(key);
  params.sort();
  return params.toString();
}
function directUrl(item: ApplicantCollection) {
  if (item.kind==="view") return new URL("/api/hub/collections/"+encodeURIComponent(item.id)+"/open",window.location.origin).href;
  const url = new URL("/team",window.location.origin);
  url.search = listQuery(item.id);
  url.searchParams.set("view","applications");
  return url.href;
}

function Comparison({rows, close}: {rows:ComparedApplication[];close:()=>void}) {
  return <section aria-label="Compare selected applications" className="hub-collection-compare">
    <div className="collection-heading"><h3>Compare applications</h3><button className="hub-text-button" type="button" onClick={close}>Close comparison</button></div>
    <div className="collection-cards">{rows.map(row=><article key={row.id}>
      <h4>{row.name}</h4><p>{row.jobTitle} · {stageLabel(row.stage)}</p>
      <dl>{Object.entries({
        Screening: row.qualification==="pass"?"Requirements met":row.qualification==="fail"?"Requirements not met":"Review",
        Owner:row.owner || "Unassigned",
        Recommendation:({advance:"Move forward",hold:"Discuss / hold",reject:"Do not move forward"} as Record<string,string>)[row.recommendation || ""],
        "Handoff salary expectation":row.salary,Availability:row.availability,Concerns:row.concerns,
      }).map(([field,value])=><div key={field}><dt>{field}</dt><dd>{value || "Not recorded"}</dd></div>)}</dl>
    </article>)}</div>
  </section>;
}

export function ApplicantCollections({filter,onApply,selectedIds,allMatching,selectionId,disabled,onChanged}:Props) {
  const data=useHubResource<ApplicantCollection[]>(endpoint), action=useHubMutation();
  const [panel,setPanel]=useState<Kind|null>(null);
  const [editing,setEditing]=useState<"create"|"edit"|"delete"|null>(null);
  const [itemId,setItemId]=useState("");
  const [creationId,setCreationId]=useState("");
  const [name,setName]=useState("");
  const [scope,setScope]=useState<Scope>("personal");
  const [updateFilters,setUpdateFilters]=useState(false);
  const [link,setLink]=useState("");
  const [notice,setNotice]=useState("");
  const [comparison,setComparison]=useState<{key:string;rows:ComparedApplication[]}|null>(null);
  const [comparing,setComparing]=useState(false);
  const [compareError,setCompareError]=useState<{key:string;message:string}|null>(null);
  const [requestTarget,setRequestTarget]=useState("");
  const panelId=useId();
  const rows=Array.isArray(data.data)?data.data:[], listId=new URLSearchParams(filter).get("listId");
  const activeList=rows.find(item=>item.id===listId && item.kind==="list");
  const visible=rows.filter(row=>row.kind===panel);
  const item=visible.find(row=>row.id===itemId);
  const requestList=rows.find(row=>row.id===requestTarget && row.kind==="list" && row.visibility==="team");
  const canUseSelection=selectedIds.length>0 && (!!selectionId || (selectedIds.length<=100 && !allMatching)) && !disabled;
  const selectionBody=selectionId ? {selectionId} : {ids:selectedIds};
  const busy=action.busy || comparing;
  const selectedKey=JSON.stringify([filter,selectedIds]);
  const compare=comparison?.key===selectedKey?comparison.rows:[];


  function open(kind:Kind, force=false) {
    action.clear();setNotice("");setLink("");setEditing(null);
    setPanel(current=>current===kind && !force?null:kind);
    setItemId(kind==="list" && activeList ? activeList.id : "");
    void data.reload();
  }
  function startEditor(mode:"create"|"edit"|"delete") {
    if (mode==="create") setCreationId(crypto.randomUUID());
    setName(mode==="edit" && item?item.name:"");
    setScope(mode==="edit" && item?item.visibility:"personal");
    setUpdateFilters(false);setEditing(mode);setLink("");setNotice("");action.clear();
  }
  async function mutate(body:Record<string,unknown>, message:string) {
    const result=await action.run<{id:string}>(endpoint,"POST",body,message);
    if (!result) {
      await data.reload();
      return;
    }
    await data.reload();
    setEditing(null);setItemId(body.action==="delete"?"":result.id);setLink("");setComparison(null);onChanged?.();
    if (body.action==="delete" && listId===result.id) {
      const params=new URLSearchParams(filter);params.delete("listId");onApply(params.toString());
    }
    return result;
  }
  async function save() {
    if (!panel) return;
    if (editing==="create") {
      await mutate({
        action:"create",creationId,kind:panel,name:name.trim(),visibility:scope,
        ...(panel==="view"?{query:viewQuery(filter)}:canUseSelection?selectionBody:{}),
      },panel==="view"?"View saved. Matching applications update automatically.":"List created.");
    } else if (item && editing==="edit") {
      await mutate({action:"edit",id:item.id,revision:item.revision,name:name.trim(),visibility:scope,
        ...(panel==="view" && updateFilters?{query:viewQuery(filter)}:{})},"Changes saved.");
    }
  }
  async function share(row:ApplicantCollection) {
    const url=directUrl(row);
    try {await navigator.clipboard.writeText(url);setNotice("Team link copied.");}
    catch {setLink(url);setNotice("Copy this internal link.");}
  }
  async function compareSelected() {
    if (!listId || selectedIds.length<2 || selectedIds.length>5) return;
    const params=new URLSearchParams({listId});
    selectedIds.forEach(id=>params.append("compare",id));
    setComparing(true);setCompareError(null);
    try {setComparison({key:selectedKey,rows:await hubRequest<ComparedApplication[]>(endpoint+"?"+params)});}
    catch(error){setCompareError({key:selectedKey,message:error instanceof Error?error.message:"Comparison unavailable."});}
    finally {setComparing(false);}
  }
  return <div className="hub-collections">
    <div className="collection-toolbar" aria-label="Applicant views and lists">
      <button type="button" className="hub-text-button" aria-expanded={panel==="view"} aria-controls={panelId} onClick={()=>open("view")}><Bookmark size={15}/>Saved views</button>
      <button type="button" className="hub-text-button" aria-expanded={panel==="list"} aria-controls={panelId} onClick={()=>open("list",canUseSelection)}><ListPlus size={16}/>{canUseSelection?"Add to list":"Candidate lists"}</button>
      {selectedIds.length>100 && !selectionId && <span role="status">Select up to 100 rows or use Select all matching to add the entire queue.</span>}
      {activeList && <strong className="collection-current">{activeList.name} · {activeList.size} {activeList.size===1?"application":"applications"}</strong>}
      {listId && !data.loading && !activeList && !data.error && <span role="status">This list is unavailable.</span>}
      {activeList?.visibility==="team" && <button className="hub-text-button" type="button" onClick={()=>setRequestTarget(activeList.id)}>Request feedback</button>}
      {activeList && canUseSelection && <>
        <button type="button" className="hub-text-button" disabled={busy} onClick={async()=>{
          const result=await mutate({action:"prioritize",id:activeList.id,revision:activeList.revision,...selectionBody},"Moved to the top of the list.");
          if (result) {const params=new URLSearchParams(filter);params.set("sort","list_order");onApply(params.toString());}
        }}>Move selected to top</button>
        <button type="button" className="hub-text-button" disabled={busy} onClick={()=>void mutate({action:"remove",id:activeList.id,revision:activeList.revision,...selectionBody},"Removed from list.")}>Remove selected from list</button>
        {selectedIds.length>=2 && selectedIds.length<=5 && <button type="button" className="hub-text-button" disabled={busy} onClick={compareSelected}>Compare selected ({selectedIds.length})</button>}
      </>}
    </div>
    {requestList && <RequestListReview key={requestList.id+selectedKey} list={requestList} ids={listId===requestList.id && selectedIds.length>0?selectedIds:undefined} close={()=>setRequestTarget("")}/>}
    {panel && <section id={panelId} className="collection-panel" aria-label={panel==="view"?"Saved views":"Candidate lists"}>
      <div className="collection-heading"><h3>{panel==="view"?"Saved views":"Candidate lists"}</h3><button className="hub-text-button" type="button" aria-label="Close saved views and lists" onClick={()=>setPanel(null)}><X size={16}/></button></div>
      <p className="hub-muted">{panel==="view"?"Save this queue’s filters and sort to use them again.":"Choose the applications that belong together. Their stages can change independently."}</p>
      {data.error && <p role="alert">{data.error} <button type="button" className="hub-text-button" onClick={data.reload}>Retry</button></p>}
      {!editing && <>
        <div className="collection-controls">
          <label>{panel==="view"?"Available views":"Available lists"}<select value={item?.id || ""} onChange={e=>{setItemId(e.target.value);setLink("");setNotice("");action.clear();}}>
            <option value="">{visible.length?"Choose one":data.loading?"Loading…":"None yet"}</option>
            {(["personal","team"] as const).map(v=><optgroup key={v} label={v==="personal"?"Personal":"Team"}>{visible.filter(row=>row.visibility===v).map(row=><option key={row.id} value={row.id}>{row.name}{row.kind==="list"?" ("+row.size+")":""}</option>)}</optgroup>)}
          </select></label>
          {item && <button type="button" className="hub-button secondary" onClick={()=>{onApply(item.kind==="view"?item.query:listQuery(item.id));setPanel(null);setLink("");}}>Open {item.kind}</button>}
          {item?.kind==="list" && canUseSelection && <button type="button" className="hub-button" disabled={busy} onClick={()=>void mutate({action:"add",id:item.id,revision:item.revision,...selectionBody},"Selection added to list.")}>Add {selectedIds.length} selected</button>}
          <button type="button" className="hub-text-button" disabled={disabled || busy || (panel==="list" && allMatching && !selectionId)} onClick={()=>startEditor("create")}>{panel==="view"?"Save current view":"Create list"}</button>
        </div>
        {item && <div className="collection-actions">
          {item.visibility==="team" && <button type="button" className="hub-text-button" onClick={()=>share(item)}><LinkIcon size={14}/>Copy team link</button>}
          {item.kind==="list" && item.visibility==="team" && item.id!==activeList?.id && <button type="button" className="hub-text-button" onClick={()=>setRequestTarget(item.id)}>Request feedback</button>}
          {item.owned && <><button type="button" className="hub-text-button" onClick={()=>startEditor("edit")}>Edit {item.kind}</button><button type="button" className="hub-text-button" onClick={()=>startEditor("delete")}>Delete {item.kind}</button></>}
        </div>}
      </>}
      {(editing==="create" || editing==="edit") && <form className="collection-editor" onSubmit={e=>{e.preventDefault();void save();}}>
        <div className="collection-controls">
          <label>{panel==="view"?"View name":"List name"}<input autoFocus required maxLength={80} value={name} onChange={e=>setName(e.target.value)}/></label>
          <label>Visibility<select value={scope} onChange={e=>setScope(e.target.value as Scope)}><option value="personal">Only me</option><option value="team">Hiring team</option></select></label>
        </div>
        {editing==="edit" && item?.kind==="list" && item.visibility==="team" && scope==="personal" && <p className="hub-muted">Team links and review requests for this list will be hidden from teammates.</p>}
        {scope==="team" && <p className="hub-muted">{panel==="list"?"Hiring staff can open this list and add or remove applications.":"Hiring staff can open this view. You control its saved filters."}</p>}
        {editing==="create" && panel==="list" && <p>{canUseSelection?`Start with ${selectedIds.length} selected application(s).`:"Start with an empty list."}</p>}
        {editing==="edit" && panel==="view" && <label><input type="checkbox" checked={updateFilters} onChange={e=>setUpdateFilters(e.target.checked)}/> Replace saved filters with the current queue</label>}
        <div className="collection-actions"><button type="submit" className="hub-button" disabled={busy || !name.trim()}>{editing==="create"?(panel==="view"?"Save view":"Create list"):"Save changes"}</button>
        <button type="button" className="hub-text-button" disabled={busy} onClick={()=>setEditing(null)}>Cancel</button></div>
      </form>}
      {editing==="delete" && item && <div><p>Delete “{item.name}”? {item.kind==="list"?"This removes its review requests and feedback. Applications will stay in their roles.":"Applications will stay in the workspace."}</p>
        <div className="collection-actions"><button type="button" className="hub-button" disabled={busy} onClick={()=>void mutate({action:"delete",id:item.id,revision:item.revision},"Deleted.")}>Confirm delete</button><button type="button" className="hub-text-button" onClick={()=>setEditing(null)}>Cancel</button></div>
      </div>}
      {link && <label>Internal link<input readOnly value={link} onFocus={e=>e.target.select()}/></label>}
    </section>}
    {action.error && <p role="alert">{action.error}</p>}
    {(action.success || notice) && <p role="status">{notice||action.success}</p>}
    {compareError?.key===selectedKey && <p role="alert">{compareError.message}</p>}
    {compare.length>0 && <Comparison rows={compare} close={()=>setComparison(null)}/>}
  </div>;
}
