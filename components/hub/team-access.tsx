"use client";
import { useState } from "react";
import { useHubMutation,useHubResource,displayDate } from "./api";
import { Badge,Feedback,Field,ResourceState } from "./shared";
import type { Member } from "./types";

type Teammate=Member & {updatedAt?:number;invite?:{status:string;lastError?:string|null;createdAt?:number;sentAt?:number|null}|null};
type TeamResponse={members:Teammate[];canManageTeam:boolean};
export function TeamAccess({member,refresh,changed}:{member:Member;refresh:number;changed:()=>void}) {
  const resource=useHubResource<TeamResponse>("/api/team",refresh),mutation=useHubMutation();
  const [email,setEmail]=useState(""),[role,setRole]=useState<Member["role"]>("recruiter");
  async function invite(event:React.FormEvent){event.preventDefault();const result=await mutation.run("/api/team","POST",{email:email.trim(),role,active:true,sendInvite:true},"Invitation queued. Delivery status appears next to your teammate.");if(result!==undefined){setEmail("");changed();void resource.reload();}}
  async function update(person:Teammate,action:"deactivate"|"reactivate"|"resend"){const result=await mutation.run("/api/team",action==="resend"?"POST":"PATCH",{email:person.email,role:person.role,active:action!=="deactivate",sendInvite:action==="resend",...(action==="resend"?{resendInvite:true}:{}),...(person.updatedAt===undefined?{}:{expectedUpdatedAt:person.updatedAt})},action==="resend"?"Invitation queued for delivery.":"Team access updated.");if(result!==undefined){changed();void resource.reload();}}
  return <section className="hub-card" aria-labelledby="team-access-title">
    <div className="hub-section-heading compact"><div><h3 id="team-access-title">Team access &amp; invitations</h3><p>Invite each person using their own Google Workspace email. They sign in themselves and connect their calendar in My connections.</p></div></div>
    <p className="hub-notice">Owners manage company connections. Head recruiters manage recruiters and all jobs. Recruiters create jobs, review applicants, and conduct interviews. Adding someone here grants hiring-dashboard access; choose each posting’s email recipients separately under Jobs → Hiring team &amp; emails.</p>
    <ResourceState loading={resource.loading} error={resource.error} retry={()=>void resource.reload()}/>
    {resource.data?.canManageTeam && <form onSubmit={invite}><fieldset disabled={mutation.busy}><div className="hub-form-grid">
      <Field label="Teammate’s Google Workspace email"><input required type="email" autoComplete="email" placeholder="name@aicaseleads.com" value={email} onChange={e=>setEmail(e.target.value)}/></Field>
      <Field label="Their role"><select value={role} onChange={e=>setRole(e.target.value as Member["role"])}><option value="recruiter">Recruiter — jobs &amp; applicants</option>{member.isOwner && <option value="admin">Head recruiter — team &amp; all jobs</option>}</select></Field>
      </div><button className="hub-button" type="submit" disabled={mutation.busy}>{mutation.busy?"Saving…":"Send invitation"}</button>
    </fieldset></form>}
    <Feedback error={mutation.error} success={mutation.success}/>
    <div className="hub-team-access-list">{resource.data?.members.map(person=>{const canEdit=resource.data!.canManageTeam && !person.isOwner && person.email.toLowerCase()!==member.email.toLowerCase() && (member.isOwner || person.role==="recruiter");return <article className="hub-team-access-item" key={person.email}>
      <div><h4>{person.email}</h4><p className="hub-muted">{person.isOwner?"Owner":person.role==="admin"?"Head recruiter":"Recruiter"} · {person.active===false?"Access removed":"Access active"}</p>{person.invite && <><Badge tone={person.invite.status==="sent"||person.invite.status==="done"?"success":person.invite.status==="failed"?"danger":"warning"}>Invitation: {person.invite.status}</Badge>{person.invite.sentAt && <p className="hub-muted">Sent {displayDate(person.invite.sentAt)}</p>}{person.invite.lastError && <p className="hub-error">{person.invite.lastError}</p>}</>}</div>
      {canEdit && <div className="hub-button-row">{person.active!==false && <button className="hub-button secondary" type="button" disabled={mutation.busy||person.invite?.status==="pending"||person.invite?.status==="running"||person.invite?.status==="uncertain"} onClick={()=>void update(person,"resend")}>Send invitation again</button>}<button type="button" className="hub-text-button" disabled={mutation.busy} onClick={()=>void update(person,person.active===false?"reactivate":"deactivate")}>{person.active===false?"Restore access":"Remove access"}</button></div>}
    </article>})}</div>
    <button type="button" className="hub-button secondary" onClick={()=>void resource.reload()} disabled={resource.loading}>Refresh invitation status</button>
    <p className="hub-muted">An invitation being queued does not confirm email delivery or Google authorization. Refresh its status, then ask the teammate to complete their own setup. Nobody needs their password.</p>
  </section>;
}
