"use client";
import { useState } from "react";
import { ExternalLink } from "lucide-react";
import { safeNavigation, useHubMutation, useHubResource } from "./api";
import { Badge, Feedback, Field, ResourceState } from "./shared";
import type { Member } from "./types";

export type PersonalAvailability = { timeZone:string; weekdays:number[]; startHour:number; endHour:number; durationMinutes:number; minimumNoticeHours:number; horizonDays:number };
export type PersonalCalendarStatus = { email:string; connected:boolean; ready:boolean; calendarId:string|null; configured:boolean; availability:PersonalAvailability; interviewers:{email:string;connected:boolean;ready:boolean}[] };

export function PersonalCalendarSetup({member,refresh=0}:{member:Member;refresh?:number}) {
  const resource=useHubResource<PersonalCalendarStatus>("/api/personal-calendar",refresh);
  const [saved,setSaved]=useState(false);
  return <section className="hub-card" aria-labelledby="personal-calendar-title">
    <div className="hub-section-heading compact"><div><h3 id="personal-calendar-title">My interview calendar</h3><p>Connect {member.email} and choose when applicants can book interviews.</p></div>{resource.data && <Badge tone={resource.data.ready?"success":"warning"}>{resource.data.ready?"Setup saved":resource.data.connected?"Save your hours":"Not connected"}</Badge>}</div>
    <ResourceState loading={resource.loading} error={resource.error} retry={()=>void resource.reload()}/>
    {saved && <p role="status" className="hub-notice">Your interview hours are saved.</p>}
    {resource.data && !resource.loading && <PersonalCalendarForm key={JSON.stringify(resource.data)} initial={resource.data} reload={()=>void resource.reload()} saved={()=>{setSaved(true);void resource.reload();}}/>}
  </section>;
}
function PersonalCalendarForm({initial,reload,saved}:{initial:PersonalCalendarStatus;reload:()=>void;saved:()=>void}) {
  const [availability,setAvailability]=useState(initial.availability);
  const save=useHubMutation(),connection=useHubMutation();
  function change<K extends keyof PersonalAvailability>(key:K,value:PersonalAvailability[K]){setAvailability(previous=>({...previous,[key]:value}));}
  async function connect(){const result=await connection.run<{url:string}>("/api/personal-calendar/connect","POST",{},"Opening your Google calendar authorization…");if(result?.url && safeNavigation(result.url))window.location.assign(result.url);}
  async function submit(event:React.FormEvent){event.preventDefault();const result=await save.run("/api/personal-calendar","PUT",{availability},"Your interview hours are saved.");if(result!==undefined)saved();}
  return <>
    <p className="hub-muted">Your Google Calendar checks busy times, creates interviews, and adds Google Meet links.</p>
    {!initial.configured && <p className="hub-notice hub-error" role="alert">The owner needs to complete Google app configuration before you can connect.</p>}
    <div className="hub-button-row"><button type="button" className="hub-button" onClick={()=>void connect()} disabled={!initial.configured||connection.busy}>{connection.busy?"Opening Google…":initial.connected?"Reconnect my calendar":"Connect my Google Calendar"}<ExternalLink size={15}/></button><button type="button" className="hub-button secondary" onClick={reload}>Refresh saved status</button></div>
    <Feedback error={connection.error} success={connection.success}/>
    {initial.connected && <p className="hub-muted">Connected calendar: <strong>{initial.calendarId || initial.email}</strong>. Existing interviews retain their original organizer.</p>}
    <form onSubmit={submit} className="hub-personal-calendar-form"><fieldset disabled={save.busy}><legend>My interview availability</legend>
      <div className="hub-form-grid">
        <Field label="My time zone" hint="For example America/Bogota, Europe/Madrid, or America/New_York."><input required value={availability.timeZone} onChange={e=>change("timeZone",e.target.value)} list="personal-time-zones"/><datalist id="personal-time-zones">{["America/Bogota","America/New_York","America/Chicago","America/Denver","America/Los_Angeles","Europe/Madrid","Europe/London","UTC"].map(zone=><option value={zone} key={zone}/>)}</datalist></Field>
        <Field label="Interview length"><select value={availability.durationMinutes} onChange={e=>change("durationMinutes",Number(e.target.value))}>{[15,30,45,60].map(value=><option key={value} value={value}>{value} minutes</option>)}</select></Field>
        <Field label="First available hour"><select value={availability.startHour} onChange={e=>change("startHour",Number(e.target.value))}>{Array.from({length:24},(_,hour)=><option key={hour} value={hour}>{String(hour).padStart(2,"0")}:00</option>)}</select></Field>
        <Field label="Finish by"><select value={availability.endHour} onChange={e=>change("endHour",Number(e.target.value))}>{Array.from({length:24},(_,index)=>index+1).map(hour=><option key={hour} value={hour}>{hour===24?"Midnight":String(hour).padStart(2,"0")+":00"}</option>)}</select></Field>

      </div>
      <fieldset className="hub-personal-days"><legend>Days I interview</legend><div className="hub-weekdays">{["Sunday","Monday","Tuesday","Wednesday","Thursday","Friday","Saturday"].map((day,index)=><label className="hub-checkbox" key={day}><input type="checkbox" checked={availability.weekdays.includes(index)} onChange={e=>change("weekdays",e.target.checked?[...availability.weekdays,index].sort():availability.weekdays.filter(value=>value!==index))}/>{day}</label>)}</div></fieldset>
      <details className="hub-setup-details"><summary>Booking notice & future dates</summary><div className="hub-form-grid">
        <Field label="Minimum booking notice"><select value={availability.minimumNoticeHours} onChange={e=>change("minimumNoticeHours",Number(e.target.value))}>{[2,4,12,24,48,72,168].map(hours=><option value={hours} key={hours}>{hours} hours</option>)}</select></Field>
        <Field label="Allow bookings ahead"><select value={availability.horizonDays} onChange={e=>change("horizonDays",Number(e.target.value))}>{[7,14,21,30].map(days=><option value={days} key={days}>{days} days</option>)}</select></Field>
      </div></details>
      <p className="hub-muted">Busy events block booking times. Existing interviews keep their time. Complete a test booking to confirm access and Meet creation.</p>
      <button className="hub-button" type="submit" disabled={save.busy||availability.weekdays.length===0||availability.endHour<=availability.startHour}>{save.busy?"Saving…":"Save my interview hours"}</button>
      <Feedback error={save.error} success={save.success}/>
    </fieldset></form>
  </>;
}

export function InterviewerChoice({value,change,renew}:{value:string;change:(value:string)=>void;renew:boolean}) {
  const resource=useHubResource<PersonalCalendarStatus>("/api/personal-calendar");
  return <div className="hub-interviewer-choice"><Field label="Who will conduct this interview?" hint={renew?"A replacement link keeps the existing interview’s organizer.":"Choose a recruiter who has connected their own calendar, or explicitly use the company calendar."}>
    <select required={!renew} value={value} onChange={e=>change(e.target.value)} disabled={renew||resource.loading}>
      <option value="">{renew?"Keep original interviewer":"Choose an interviewer"}</option>
      <option value="__shared__">Shared company calendar</option>
      {(resource.data?.interviewers || []).map(person=><option value={person.email} key={person.email} disabled={!person.ready}>{person.email}{person.ready?"":" — setup needed"}</option>)}
    </select>
  </Field><ResourceState loading={resource.loading} error={resource.error} retry={()=>void resource.reload()}/><p className="hub-muted">Each recruiter connects in Settings → My connections. Interview emails use the configured recruiting email account; the selected person’s calendar controls available times.</p></div>;
}
