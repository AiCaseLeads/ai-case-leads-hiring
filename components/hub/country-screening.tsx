"use client";
import { useState } from "react";
import { countryRegions, regionSelection, toggleRegion } from "@/lib/country-regions";
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
  return <section className="hub-screening-question hub-country-screening" aria-label="Country of residence screening">
    <p>The full country list is included automatically. Applicants choose where they live, not their nationality.</p>
    <Field label="Eligible countries"><select value={mode} onChange={event=>{if(event.target.value==="any")change(rules.filter(rule=>rule.fieldPath!==field.path));else update(event.target.value as "in"|"not_in",selected);}}><option value="any">Any country — no country screening</option><option value="in">Only selected countries</option><option value="not_in">Exclude selected countries</option></select></Field>
    {mode!=="any" && <>
      <fieldset style={{margin:"12px 0",padding:12,border:"1px solid #d7e3e1",borderRadius:8}}>
        <legend>Select by region</legend>
        <p className="hub-muted">Select a whole region, then adjust individual countries below. North America includes Central America and the Caribbean.</p>
        <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(min(100%,160px),1fr))",gap:12}}>{countryRegions.map(region=>{const state=regionSelection(region.codes,selected);return <label className="hub-checkbox" key={region.name}><input type="checkbox" aria-label={region.name} checked={state.all} aria-checked={state.partial?"mixed":state.all} ref={element=>{if(element)element.indeterminate=state.partial;}} onChange={event=>update(mode as "in"|"not_in",toggleRegion(region.codes,selected,event.target.checked))}/><span>{region.name} <small>({state.count}/{region.codes.length})</small></span></label>;})}</div>
      </fieldset>
      <Field label="Find countries"><input type="search" value={query} onChange={event=>setQuery(event.target.value)} placeholder="Search country name or code"/></Field>
      <p>{selected.length} countries selected. {mode==="in"?"Applicants must live in one of these countries.":"Applicants must live outside these countries."}</p>
      <div role="group" aria-label="Select countries" style={{maxHeight:240,overflowY:"auto",display:"grid",gap:8,padding:8,border:"1px solid #d7e3e1",borderRadius:8}}>{countryRegions.map(region=>{const options=countryOptions.filter(option=>region.codes.includes(option.value as never) && `${option.label} ${option.value}`.toLowerCase().includes(query.toLowerCase()));return options.length?<fieldset key={region.name} style={{border:0,padding:0,margin:"0 0 12px",minWidth:0}}><legend style={{fontWeight:600,marginBottom:8}}>{region.name}</legend><div style={{display:"grid",gap:8}}>{options.map(option=><label className="hub-checkbox" key={option.value}><input type="checkbox" checked={selected.includes(option.value)} onChange={event=>update(mode as "in"|"not_in",event.target.checked?[...selected,option.value]:selected.filter(value=>value!==option.value))}/>{option.label}</label>)}</div></fieldset>:null;})}</div>
      {!selected.length && <p role="alert">Select at least one country, or choose Any country before saving.</p>}
      <p className="hub-muted">Country of residence is required while screening is enabled. {autoReject?"Applicants outside this requirement receive your automatic rejection email.":"This marks screening results only. Enable Automatic screening rejection to send rejection emails."}</p>
    </>}
  </section>;
}
