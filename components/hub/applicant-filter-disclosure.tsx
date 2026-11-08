"use client";
import {useId,useState,type ReactNode} from 'react';

/** One set of controls: visible on desktop, explicitly expanded on small screens. */
export function ApplicantFilterDisclosure({activeCount,children,headerAction}:{activeCount:number;children?:ReactNode;headerAction?:ReactNode}) {
 const [expanded,setExpanded]=useState(false),id=useId();
 return <div className="hub-extra-filters" data-expanded={expanded}>
  <button type="button" className="hub-extra-filters-toggle" aria-expanded={expanded} aria-controls={id} onClick={()=>setExpanded(value=>!value)}>Filters &amp; order{activeCount>0&&<span className="hub-filter-active-count" aria-label={`${activeCount} active filters`}>{activeCount}</span>}<span aria-hidden="true">{expanded?'−':'+'}</span></button>
  {headerAction&&<div className="hub-extra-filters-action">{headerAction}</div>}
  <div id={id} className="hub-extra-filters-body">{children}</div>
 </div>;
}
