"use client";
import { useState } from "react";
import { useHubMutation, useHubResource } from "./api";
import { Field, Feedback, ResourceState } from "./shared";
import type { ApplicationDetail, HubJob } from "./types";
import { calculateScore, type Catalog, type Rubric, type Template, type Rating } from "@/lib/scorecards/model";
const defaultAnchors: [string,string,string,string,string] = ["No supporting evidence", "Limited supporting evidence", "Meets the criterion", "Strong evidence of the criterion", "Exceeds the criterion with clear evidence"];
const blank = (): Rubric => ({name: "", criteria: [{label: "", weight: 1, anchors: [...defaultAnchors]}]});
export function ScorecardTemplates({jobs}: {jobs: HubJob[]}) {
  const resource = useHubResource<Catalog>("/api/scorecards"), mutation = useHubMutation();
  const [draft, setDraft] = useState<Rubric>(blank), [editorOpen, setEditorOpen] = useState(false), [editing, setEditing] = useState<string | undefined>(), [jobId, setJobId] = useState(""), [choice, setChoice] = useState("");
  const catalog = resource.data;
  const latest = catalog?.templates.filter(t => !catalog.archived.includes(t.id) && !catalog.templates.some(other => other.id === t.id && other.version > t.version)) || [];
  const templateKey = (t: {id: string; version: number}) => `${t.id}:${t.version}`;
  const binding = catalog?.bindings[jobId];
  const assigned = catalog?.templates.find(t => t.id === binding?.templateId && t.version === binding?.version);
  const options = assigned && !latest.some(t => templateKey(t) === templateKey(assigned)) ? [assigned, ...latest] : latest;
  const selected = catalog?.templates.find(t => templateKey(t) === choice);
  const unavailableChoice = !!choice && (!selected || !!catalog?.archived.includes(selected.id));
  function edit(template?: Template) { setEditing(template?.id); setDraft(template ? {name: template.name, criteria: structuredClone(template.criteria)} : blank()); setEditorOpen(true); mutation.clear(); }
  function criterionChange(index: number, change: Partial<Rubric["criteria"][number]>) { setDraft(current => ({...current, criteria: current.criteria.map((c, n) => n === index ? {...c, ...change} : c)})); }
  async function change(body: Record<string, unknown>, message: string) { if (!catalog) return; const result = await mutation.run<Catalog>("/api/scorecards", "PATCH", {...body, expectedRevision: catalog.revision}, message); if (result) void resource.reload(); return result; }
  return <section aria-labelledby="scorecard-library-title">
    <div className="hub-section-heading compact"><div><h3 id="scorecard-library-title">Reusable scorecards</h3><p>Save the criteria your reviewers should use. Choose a template when creating a job.</p></div><button className="hub-button secondary" type="button" disabled={mutation.busy || !catalog} onClick={() => edit()}>New scorecard template</button></div>
    <ResourceState loading={resource.loading} error={resource.error} retry={() => void resource.reload()} /><Feedback error={mutation.error} success={mutation.success} />
    {catalog && <><ul className="hub-scorecard-library">{latest.map(t => <li key={t.id}><div><strong>{t.name}</strong><p>{t.criteria.length} {t.criteria.length === 1 ? "criterion" : "criteria"} · version {t.version}</p></div><button className="hub-button secondary" type="button" disabled={mutation.busy} onClick={() => edit(t)}>Edit {t.name}</button></li>)}</ul>{!latest.length && <p className="hub-muted">No templates yet. Add criteria that matter for the job, such as the quality of an approved work sample.</p>}</>}
    {editorOpen && <form className="hub-scorecard-editor" onSubmit={async e => { e.preventDefault(); if (await change({action: "save", templateId: editing, rubric: draft}, "Scorecard template saved. Choose it in a job’s review step.")) {setEditorOpen(false);setEditing(undefined);setDraft(blank());} }}><fieldset disabled={mutation.busy}>
      <h4>{editing ? "Edit scorecard template" : "Create scorecard template"}</h4>
      <Field label="Scorecard template name" hint="For example, Portfolio review. This does not add job requirements automatically."><input required maxLength={120} value={draft.name} onChange={e => setDraft({...draft, name: e.target.value})} /></Field>
      <p className="hub-scorecard-scale">Default scale: 1 = no evidence, 2 = limited evidence, 3 = meets the criterion, 4 = strong evidence, 5 = exceeds it. Reviewers must record supporting evidence.</p>
      {draft.criteria.map((criterion, i) => <fieldset className="hub-scorecard-criterion" key={i}><legend>Criterion {i + 1}</legend>
        <Field label={`Criterion ${i + 1} name`} hint="What should the reviewer assess?"><input required maxLength={180} value={criterion.label} onChange={e => criterionChange(i, {label: e.target.value})} /></Field>
        <details className="hub-setup-details"><summary>Customize rating definitions and weight</summary>
          <Field label={`Criterion ${i + 1} weight`} hint="Leave at 1 for equal weighting."><input type="number" min={1} max={10} required value={criterion.weight} onChange={e => criterionChange(i, {weight: Number(e.target.value)})} /></Field>
          {criterion.anchors.map((anchor, j) => <Field key={j} label={`Criterion ${i + 1}: what earns ${j + 1} of 5?`}><input required maxLength={200} value={anchor} onChange={e => criterionChange(i, {anchors: criterion.anchors.map((a, k) => k === j ? e.target.value : a) as typeof criterion.anchors})} /></Field>)}
        </details>
        {draft.criteria.length > 1 && <button type="button" className="hub-text-button" onClick={() => setDraft({...draft, criteria: draft.criteria.filter((_, n) => n !== i)})}>Remove criterion {i + 1}</button>}
      </fieldset>)}
      <div className="hub-inline-actions"><button type="button" className="hub-button secondary" disabled={draft.criteria.length >= 8} onClick={() => setDraft({...draft, criteria: [...draft.criteria, ...blank().criteria]})}>Add criterion</button><button className="hub-button" disabled={!catalog}>{mutation.busy ? "Saving…" : "Save template version"}</button><button type="button" className="hub-text-button" onClick={() => {setEditorOpen(false);mutation.clear();}}>Cancel</button></div>
      {editing && <details className="hub-setup-details"><summary>Archive this template</summary><p>Removes it from new assignments. Existing jobs and saved reviews keep their version.</p><button type="button" className="hub-button secondary" onClick={async () => { if (await change({action: "archive", templateId: editing}, "Template archived. Existing jobs and reviews retain their version.")) setEditorOpen(false); }}>Archive template</button></details>}
    </fieldset></form>}
    <details className="hub-setup-details"><summary>Change a scorecard on an existing job</summary><p>Editing a template creates a new version. Existing jobs keep their version until you explicitly change it here.</p>
      <form onSubmit={async e => {e.preventDefault(); if (unavailableChoice) return; const template = selected; await change({action: "bind", jobId, templateId: choice ? template!.id : null, ...(template ? {version: template.version} : {})}, "Job scorecard assignment saved.");}}><fieldset disabled={mutation.busy}>
        <Field label="Scorecard job posting"><select required value={jobId} onChange={e => {setJobId(e.target.value); const b = catalog?.bindings[e.target.value]; setChoice(b ? `${b.templateId}:${b.version}` : "");}}><option value="">Choose a saved job</option>{jobs.map(j => <option key={j.id} value={j.id}>{j.title} · {j.location || j.archiveCountry || "Location not set"} · {j.status || "Draft"} · /{j.slug || j.id}</option>)}</select></Field>
        {jobId && <p>Current assignment: {assigned ? `${assigned.name} · version ${assigned.version}` : "Manual scorecard only"}</p>}
        <Field label="Reusable scorecard template"><select value={choice} onChange={e => setChoice(e.target.value)}><option value="">Manual scorecard only</option>{options.map(t => <option key={templateKey(t)} value={templateKey(t)} disabled={catalog?.archived.includes(t.id)}>{t.name} · version {t.version}{catalog?.archived.includes(t.id) ? " (archived; current assignment retained)" : ""}</option>)}</select></Field>
        <button className="hub-button" disabled={!jobId || mutation.busy || !catalog || unavailableChoice}>Save job scorecard</button>{unavailableChoice && <p>The assigned template is archived. It stays assigned until you explicitly choose another template or Manual scorecard only.</p>}
      </fieldset></form>
    </details>
  </section>;
}
export function useScorecardDraft(){return useState<{key:string;ratings:Partial<Rating>[]}>(()=>({key:"",ratings:[]}));}
export function ReusableScorecard({detail,draft:state,saved}:{detail:ApplicationDetail;draft:ReturnType<typeof useScorecardDraft>;saved:()=>void}){
 const resource=useHubResource<{template:Template|null}>("/api/scorecards?jobId="+encodeURIComponent(detail.jobId)),mutation=useHubMutation();
 const [draft,setDraft]=state,template=resource.data?.template;
 const key=template?`${detail.id}:${template.id}:${template.version}`:"";
 const ratings=draft.key===key?draft.ratings:[];
 function update(i:number,change:Partial<Rating>){const next=template!.criteria.map((_,n)=>ratings[n]||{});next[i]={...next[i],...change};setDraft({key,ratings:next});}
 const complete=!!template&&template.criteria.every((_,i)=>ratings[i]?.score&&ratings[i]?.evidence?.trim());
 const grade=complete?calculateScore(template!,ratings as Rating[]):null;
 return <section className="hub-card"><h3>Reusable scorecard review</h3><Feedback error={resource.error||mutation.error} success={mutation.success}/>{resource.loading?<p>Loading assigned scorecard…</p>:template?<form onSubmit={async e=>{e.preventDefault();const result=await mutation.run("/api/scorecards/reviews","POST",{applicationId:detail.id,expectedRevision:detail.revision,templateId:template.id,version:template.version,ratings},"Scorecard saved with its criteria and evidence.");if(result){setDraft({key:"",ratings:[]});saved();}}}><fieldset disabled={mutation.busy}><h4>{template.name} · version {template.version}</h4><p>Score each criterion from the evidence. If evidence is missing, collect it before grading. This is a human assessment; it does not move or reject the applicant.</p>{template.criteria.map((c,i)=><fieldset key={i}><legend>{c.label}{c.weight!==1?` · weight ${c.weight}`:""}</legend><Field label={`${c.label}: score`}><select required value={ratings[i]?.score||""} onChange={e=>update(i,{score:Number(e.target.value)})}><option value="">Choose a score</option>{c.anchors.map((a,n)=><option key={n} value={n+1}>{n+1} — {a}</option>)}</select></Field><Field label={`${c.label}: supporting evidence`}><textarea required maxLength={750} value={ratings[i]?.evidence||""} onChange={e=>update(i,{evidence:e.target.value})}/></Field></fieldset>)}<p>The criterion mean becomes your overall score, preserving decimals (3.5/5 = 70/100). Full criterion scores and the exact mean remain in the saved review. Your latest review replaces your earlier review in ranking.</p>{grade&&<p>Overall grade {grade.exact.toFixed(2)}/5 · {(grade.exact*20).toFixed(1)}/100</p>}<button className="hub-button" disabled={!complete||mutation.busy}>Save reusable scorecard</button></fieldset></form>:<p>No reusable scorecard is assigned to this job. A manager can assign one under Settings → Scorecard templates. Manual scorecards are still available.</p>}<button type="button" className="hub-button secondary" disabled={mutation.busy} onClick={()=>void resource.reload()}>Reload assigned scorecard</button></section>;
}
