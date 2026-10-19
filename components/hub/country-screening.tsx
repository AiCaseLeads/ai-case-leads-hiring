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
  const visibleGroups=countryRegions.map(region=>({...region,options:countryOptions.filter(option=>region.codes.includes(option.value as never) && `${option.label} ${option.value}`.toLowerCase().includes(query.trim().toLowerCase()))})).filter(region=>region.options.length);
  return <section className="hub-screening-question hub-country-screening" aria-label="Country of residence screening">
    <div className="hub-country-controls">
      <Field label="Eligible countries"><select value={mode} onChange={event=>{if(event.target.value==="any")change(rules.filter(rule=>rule.fieldPath!==field.path));else update(event.target.value as "in"|"not_in",selected);}}><option value="any">Any country — no country screening</option><option value="in">Only selected countries</option><option value="not_in">Exclude selected countries</option></select></Field>
      {mode!=="any" && <Field label="Find countries"><input type="search" value={query} onChange={event=>setQuery(event.target.value)} placeholder="Country name or code"/></Field>}
    </div>
    {mode!=="any" ? <>
      <fieldset className="hub-country-regions">
        <legend>Select by region</legend>
        <div className="hub-country-region-options">{countryRegions.map(region=>{const state=regionSelection(region.codes,selected);return <label className="hub-checkbox" key={region.name}><input type="checkbox" aria-label={region.name} checked={state.all} aria-checked={state.partial?"mixed":state.all} ref={element=>{if(element)element.indeterminate=state.partial;}} onChange={event=>update(mode as "in"|"not_in",toggleRegion(region.codes,selected,event.target.checked))}/><span>{region.name} <small>({state.count}/{region.codes.length})</small></span></label>;})}</div>
        <p className="hub-country-note">North America includes Central America and the Caribbean.</p>
      </fieldset>
      <p className="hub-country-selection-count" role="status">{selected.length} selected · {mode==="in"?"Must live in a selected country":"Must live outside selected countries"}</p>
      <div className="hub-country-list" role="group" aria-label="Select countries">
        {visibleGroups.map(region=><fieldset className="hub-country-group" key={region.name}><legend>{region.name}</legend><div className="hub-country-options">{region.options.map(option=><label className="hub-checkbox" key={option.value}><input type="checkbox" checked={selected.includes(option.value)} onChange={event=>update(mode as "in"|"not_in",event.target.checked?[...selected,option.value]:selected.filter(value=>value!==option.value))}/><span>{option.label}</span></label>)}</div></fieldset>)}
        {!visibleGroups.length && <p className="hub-country-note">No countries match your search.</p>}
      </div>
      {!selected.length && <p role="alert">Select at least one country, or choose Any country before saving.</p>}
      <p className="hub-country-note">Residence is required. {autoReject?"Failed location screening: automatic rejection.":"Failed location screening: recruiter review."}</p>
    </> : <p className="hub-country-note">Applicants choose their country of residence, not nationality.</p>}
  </section>;
}
