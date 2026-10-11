import { z } from "zod";
import type { HubStore } from "../hub/store";
import type { MailInput } from "../google/workspace";
import type { Task } from "../hub/types";
import { sha256 } from "../hiring/crypto";

export const CONFIG_KEY="review_reminders_v1";
export const configSchema=z.object({enabled:z.boolean(),dueHours:z.number().int().min(1).max(720),fallbackAdmins:z.array(z.string().trim().email().transform(v=>v.toLowerCase())).max(10)}).strict();
export type ReminderConfig=z.infer<typeof configSchema>;
export const DEFAULT_CONFIG:ReminderConfig={enabled:false,dueHours:48,fallbackAdmins:[]};
type Staff={email:string;role:string};
export type OverdueApplication={id:string;name:string;jobTitle:string;assignee:string|null;stageEnteredAt:number};
export async function configuration(store:HubStore):Promise<ReminderConfig>{
  const raw=await store.setting(CONFIG_KEY,DEFAULT_CONFIG),parsed=configSchema.safeParse(raw);
  return parsed.success?parsed.data:DEFAULT_CONFIG;
}
export async function activeStaff(store:HubStore,owners:string[]=[]):Promise<Staff[]>{
  const staff=await store.rows<Staff>("SELECT lower(email) AS email,role FROM hub_members WHERE active=1 AND role IN ('admin','recruiter')");
  const byEmail=new Map(staff.map(row=>[row.email,row]));
  for(const owner of owners){const email=owner.trim().toLowerCase();if(z.string().email().safeParse(email).success)byEmail.set(email,{email,role:"admin"});}
  return [...byEmail.values()];
}
const dueSql="a.stage='Application Review' AND a.stage_entered_at<=? AND NOT EXISTS (SELECT 1 FROM hub_scorecards s WHERE s.application_id=a.id)";
export async function overdueQueue(store:HubStore,config:ReminderConfig,now=Date.now(),offset=0,assignee?:string){
  const cutoff=now-config.dueHours*3600000;
  const filter=assignee===undefined?"":" AND lower(trim(COALESCE(a.assignee,'')))=?";
  const values=assignee===undefined?[cutoff]:[cutoff,assignee];
  const total=await store.stmt(`SELECT COUNT(*) AS count FROM hub_applications a WHERE ${dueSql}${filter}`,...values).first<{count:number}>();
  const applications=await store.rows<OverdueApplication>(`SELECT a.id,a.name,a.job_title AS jobTitle,a.assignee,a.stage_entered_at AS stageEnteredAt FROM hub_applications a WHERE ${dueSql}${filter} ORDER BY a.stage_entered_at,a.id LIMIT 50 OFFSET ?`,...values,offset);
  return {applications,total:total?.count||0,offset,limit:50};
}
// Compute a recipient's current queue with SQL. Do not embed a thousand candidate
// records in each Gmail task or retain obsolete recipient/application snapshots.
async function recipientQueue(store:HubStore,config:ReminderConfig,staff:Staff[],recipient:string,now:number){
  if(!staff.some(s=>s.email===recipient))return null;
  const active=staff.map(s=>s.email);
  const fallback=config.fallbackAdmins.includes(recipient)&&staff.some(s=>s.email===recipient&&s.role==="admin");
  const assigned="lower(trim(COALESCE(a.assignee,'')))";
  const match=active.length?`(${assigned}=? ${fallback?`OR ${assigned} NOT IN (${active.map(()=>"?").join(",")})`:""})`:"0=1";
  const values:[number,string,...string[]]=[now-config.dueHours*3600000,recipient,...(fallback?active:[])];
  return store.stmt(`SELECT COUNT(*) AS count,MIN(a.id) AS anchor FROM hub_applications a WHERE ${dueSql} AND ${match}`,...values).first<{count:number;anchor:string|null}>();
}
export function reminderDay(now:number){return new Intl.DateTimeFormat("en-CA",{timeZone:"America/Bogota",year:"numeric",month:"2-digit",day:"2-digit"}).format(now);}
export async function enqueueReviewReminders(store:HubStore,owners:string[]=[],now=Date.now()):Promise<number>{
  const config=await configuration(store);
  if(!config.enabled)return 0;
  const staff=await activeStaff(store,owners);
  const day=reminderDay(now);
  let queued=0;
  for(const person of staff){
    const id=`review-reminder:${day}:${await sha256(person.email)}`;
    // Fast worker ticks must not rescan every candidate after this person's
    // daily digest already exists (including uncertain or failed deliveries).
    if(await store.stmt("SELECT id FROM hub_tasks WHERE id=?",id).first())continue;
    const current=await recipientQueue(store,config,staff,person.email,now);
    if(!current?.count||!current.anchor)continue;
    const inserted=await store.taskStatement(id,current.anchor,"gmail",{reviewReminder:true,recipient:person.email,day,messageId:`<${await sha256(id)}@jobs.aicaseleads.com>`},now).run();
    queued+=inserted.meta?.changes||0;
  }
  return queued;
}
export async function reviewReminderMail(task:Task,store:HubStore,owners:string[]=[],now=Date.now()):Promise<MailInput|null>{
  const config=await configuration(store);
  // A delayed digest must not appear alongside the next day's digest.
  if(!config.enabled||task.payload.day!==reminderDay(now)||typeof task.payload.recipient!=="string"||typeof task.payload.messageId!=="string")return null;
  const recipient=task.payload.recipient;
  const staff=await activeStaff(store,owners);
  const fallback=config.fallbackAdmins.includes(recipient)&&staff.some(s=>s.email===recipient&&s.role==="admin");
  const current=await recipientQueue(store,config,staff,recipient,now);
  if(!current?.count)return null;
  const origin=store.options.origin||"https://jobs.aicaseleads.com";
  const url=new URL("/team?reviews=overdue",origin).toString();
  return {to:recipient,subject:"Hiring review reminder",messageId:task.payload.messageId,body:`You have ${current.count} application${current.count===1?"":"s"} waiting for an initial human review for at least ${config.dueHours} hours.\n\nOpen the overdue review queue: ${url}\n\nThis digest includes applications assigned to you${fallback?" and unassigned applications covered by your manager fallback":""}. Record a scorecard or move the application out of Application Review after reviewing it. Notes and AI evidence summaries alone do not mark a human review complete.\n\nThis is an internal team reminder; no applicant was emailed.`};
}
