"use client";
import {useState} from 'react';
import {ChevronLeft, ChevronRight} from 'lucide-react';

const weekdays = ['Su','Mo','Tu','We','Th','Fr','Sa'];
const monthName = new Intl.DateTimeFormat('en-US',{month:'long',year:'numeric',timeZone:'UTC'});
const fullDate = new Intl.DateTimeFormat('en-US',{weekday:'long',month:'long',day:'numeric',year:'numeric',timeZone:'UTC'});

export function interviewDayLabel(key: string) {
  return fullDate.format(new Date(key+'T00:00:00Z'));
}

export function InterviewCalendar({days,selectedDay,onSelect}:{
  days:string[];selectedDay:string;onSelect:(date:string)=>void;
}) {
  const months = [...new Set(days.map(day=>day.slice(0,7)))].sort();
  const [view,setView] = useState('');
  const month = months.includes(view) ? view : months[0];
  if (!month) return null;
  function changeMonth(next:string) { setView(next); onSelect(''); }
  const monthIndex=months.indexOf(month);
  const first=new Date(month+'-01T00:00:00Z');
  const length=new Date(Date.UTC(first.getUTCFullYear(),first.getUTCMonth()+1,0)).getUTCDate();
  const available = new Set(days);
  return <section aria-label="Interview date" className="interview-calendar">
    <div className="interview-month">
      <button type="button" aria-label="Previous month" disabled={monthIndex===0} onClick={()=>changeMonth(months[monthIndex-1])}><ChevronLeft size={17} aria-hidden="true"/></button>
      <strong aria-live="polite">{monthName.format(first)}</strong>
      <button type="button" aria-label="Next month" disabled={monthIndex===months.length-1} onClick={()=>changeMonth(months[monthIndex+1])}><ChevronRight size={17} aria-hidden="true"/></button>
    </div>
    <div className="interview-days">
      {weekdays.map(d=><span aria-hidden="true" key={d}>{d}</span>)}
      {Array.from({length:first.getUTCDay()},(_,i)=><span key={'empty'+i}/>)}
      {Array.from({length},(_,i)=>{
        const key=month+'-'+String(i+1).padStart(2,'0');
        return <button type="button" key={key} aria-label={interviewDayLabel(key)} aria-pressed={selectedDay===key} disabled={!available.has(key)} onClick={()=>onSelect(key)}>{i+1}</button>;
      })}
    </div>
  </section>;
}
