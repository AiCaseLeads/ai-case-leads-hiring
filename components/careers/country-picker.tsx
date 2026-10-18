"use client";
import { useState } from "react";
import type { CareerField } from "./types";
export function CountryPicker({field,value,onChange,error}:{field:CareerField;value:string;onChange:(value:string)=>void;error?:string}) {
  const [query,setQuery]=useState("");
  const options=field.options || [];
  const visible=options.filter(option=>option.value===value || `${option.label} ${option.value}`.toLowerCase().includes(query.toLowerCase()));
  const describedBy=[field.description && `${field.path}-help`,error && `${field.path}-error`].filter(Boolean).join(" ") || undefined;
  return <div style={{display:"grid",gap:8}}>
    <input type="search" className="form-input" aria-label={`Search countries for ${field.title}`} placeholder="Search countries" value={query} onChange={event=>setQuery(event.target.value)} autoComplete="off"/>
    <select id={field.path} className="form-select" required={field.required} aria-invalid={!!error} aria-describedby={describedBy} value={value} onChange={event=>{onChange(event.target.value);setQuery("");}}>
      <option value="">Choose your country of residence</option>
      {visible.map(option=><option key={option.value} value={option.value}>{option.label}</option>)}
    </select>
    {query && visible.length===0 && <p role="status">No countries match that search.</p>}
  </div>;
}
