"use client";
import { useEffect, useState } from "react";

/** Only prompts while the applicant is reading above the form; never overlays form controls. */
export function MobileApply({enabled}:{enabled:boolean}) {
 const [visible,setVisible]=useState(false);
 useEffect(()=>{
  if(!enabled)return;
  let frame=0;
  const update=()=>{
   frame=0;
   const panel=document.getElementById('job-application');
   const viewport=window.visualViewport;
   const keyboardOpen=!!viewport&&window.innerHeight-viewport.height>150;
   const editing=document.activeElement?.matches('input,textarea,select,[contenteditable="true"]');
   setVisible(window.matchMedia('(max-width:640px)').matches&&!keyboardOpen&&!editing&&!!panel&&!panel.contains(document.activeElement)&&panel.getBoundingClientRect().top>window.innerHeight);
  };
  const schedule=()=>{if(!frame)frame=requestAnimationFrame(update);};
  update();
  window.addEventListener('scroll',schedule,{passive:true});window.addEventListener('resize',schedule);
  window.visualViewport?.addEventListener('resize',schedule);
  document.addEventListener('focusin',schedule);document.addEventListener('focusout',schedule);
  const observer=new ResizeObserver(schedule);observer.observe(document.body);
  return ()=>{cancelAnimationFrame(frame);observer.disconnect();window.removeEventListener('scroll',schedule);window.removeEventListener('resize',schedule);window.visualViewport?.removeEventListener('resize',schedule);document.removeEventListener('focusin',schedule);document.removeEventListener('focusout',schedule);};
 },[enabled]);
 if(!enabled||!visible)return null;
 return <div className="mobile-apply-bar"><a className="button ink" href="#job-application" onClick={event=>{
  const panel=document.getElementById('job-application');if(!panel)return;
  event.preventDefault();setVisible(false);panel.focus({preventScroll:true});panel.scrollIntoView({block:'start',behavior:window.matchMedia('(prefers-reduced-motion: reduce)').matches?'instant':'smooth'});
 }}>Apply for this job</a></div>;
}
