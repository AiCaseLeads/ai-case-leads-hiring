import type { AnchorHTMLAttributes, ReactNode } from "react";

/** Preserve native new-tab, context-menu and long-press navigation. */
export function NavigationLink({ navigate, children, ...props }: AnchorHTMLAttributes<HTMLAnchorElement> & {navigate:()=>void;children:ReactNode}) {
  return <a {...props} onClick={event=>{
    if(event.defaultPrevented || event.button!==0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || props.target==="_blank")return;
    event.preventDefault();navigate();
  }}>{children}</a>;
}
export function applicantHref(id:string,filter="",jobId?:string) {
  const params=new URLSearchParams(filter);params.set("view","applications");params.set("application",id);
  if(jobId)params.set("jobId",jobId);
  return `/team?${params}`;
}
