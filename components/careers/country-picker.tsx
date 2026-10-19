"use client";
import type { CareerField } from "./types";
export function CountryPicker({field,value,onChange,error}:{field:CareerField;value:string;onChange:(value:string)=>void;error?:string}) {
  const options=field.options || [];
  const describedBy=[field.description && `${field.path}-help`,error && `${field.path}-error`].filter(Boolean).join(" ") || undefined;
  return <div style={{display:"grid",gap:8}}>
    <select id={field.path} className="form-select" required={field.required} aria-invalid={!!error} aria-describedby={describedBy} value={value} onChange={event=>onChange(event.target.value)}>
      <option value="">Choose your country of residence</option>
      {options.map(option=><option key={option.value} value={option.value}>{option.label}</option>)}
    </select>
  </div>;
}
