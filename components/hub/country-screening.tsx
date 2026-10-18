"use client";
import { useState } from "react";
import { countryOptions } from "@/lib/countries";
import type { ApplicationField } from "@/lib/hiring/types";
import type { Rule } from "./types";
import { Field } from "./shared";
export function CountryScreening({field,rules,change,requireAnswer,autoReject}:{field:ApplicationField;rules:Rule[];change:(rules:Rule[])=>void;requireAnswer:()=>void;autoReject:boolean}) {
  const [query,setQuery]=useState("");
  const existing=rules.find(rule=>rule.fieldPath===field.path && ["in","not_in"].includes(rule.operator));
  const mode=existing?.enabled ? existing.operator : "any";
  const selected=Array.isArray(existing?.value)?existing.value:[];
  function update(operator:"in"|"not_in",value:string[]) {requireAnswer();change([...rules.filter(rule=>rule.fieldPath!==field.path),{fieldPath:field.path,operator,value,enabled:true,reason:"Country of residence does not meet this job’s location requirements."}]);}
  return <section className="hub-screening-question" aria-label="Country of residence screening">
    <p>The full country list is included automatically. Applicants choose where they live, not their nationality.</p>
    <Field label="Eligible countries"><select value={mode} onChange={event=>{if(event.target.value==="any")change(rules.filter(rule=>rule.fieldPath!==field.path));else update(event.target.value as "in"|"not_in",selected);}}><option value="any">Any country — no country screening</option><option value="in">Only selected countries</option><option value="not_in">Exclude selected countries</option></select></Field>
    {mode!=="any" && <>
      <Field label="Find countries"><input type="search" value={query} onChange={event=>setQuery(event.target.value)} placeholder="Search country name or code"/></Field>
      <p>{selected.length} countries selected. {mode==="in"?"Applicants must live in one of these countries.":"Applicants must live outside these countries."}</p>
      <div role="group" aria-label="Select countries" style={{maxHeight:240,overflowY:"auto",display:"grid",gap:8,padding:8,border:"1px solid #d7e3e1",borderRadius:8}}>{countryOptions.filter(option=>`${option.label} ${option.value}`.toLowerCase().includes(query.toLowerCase())).map(option=><label className="hub-checkbox" key={option.value}><input type="checkbox" checked={selected.includes(option.value)} onChange={event=>update(mode as "in"|"not_in",event.target.checked?[...selected,option.value]:selected.filter(value=>value!==option.value))}/>{option.label}</label>)}</div>
      {!selected.length && <p role="alert">Select at least one country, or choose Any country before saving.</p>}
      <p className="hub-muted">Country of residence is required while screening is enabled. {autoReject?"Applicants outside this requirement receive your automatic rejection email.":"This marks screening results only. Enable Automatic screening rejection to send rejection emails."}</p>
    </>}
  </section>;
}
