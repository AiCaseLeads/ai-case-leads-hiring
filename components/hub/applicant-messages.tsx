import type { ApplicationDetail } from "./types";
import { Badge } from "./shared";
import { displayDate } from "./api";
import { communicationSummary } from "./activity-summary";

export function ApplicantMessages({ detail, busy, compose }: {detail:ApplicationDetail;busy:boolean;compose:()=>void}) {
  return <section className="hub-card hub-applicant-messages" aria-labelledby="applicant-messages-title">
    <div className="hub-section-heading compact"><h3 id="applicant-messages-title">Messages</h3><button type="button" className="hub-button secondary" disabled={busy||detail.trashed} onClick={compose}>Write email</button></div>
    <p className="hub-muted">Replies appear here only when they are imported from a connected recruiting mailbox. Refresh to check for updates.</p>
    {detail.communications.length ? [...detail.communications].sort((a,b)=>b.createdAt-a.createdAt).map(message=>{
      const received=message.direction==="incoming"||message.status==="received";
      const state=received?{label:"Reply received",explanation:"A received message was recorded for this application."}:communicationSummary(message.status);
      return <article className="hub-history-item" key={message.id}>
        <div className="hub-section-heading compact"><strong>{message.subject||message.purpose||"Email"}</strong><Badge tone={received?"success":"neutral"}>{state.label}</Badge></div>
        <small>{received?"Incoming":"Outgoing"} · {displayDate(message.createdAt)}</small>
        <p className="hub-muted">{state.explanation}</p>
        {(message.sender||message.to?.length||message.cc?.length||message.replyTo?.length)&&<details><summary>Recipients and reply contact</summary><dl>
          {message.sender&&<><dt>From</dt><dd>{message.sender}</dd></>}
          {!!message.to?.length&&<><dt>To</dt><dd>{message.to.join(", ")}</dd></>}
          {!!message.cc?.length&&<><dt>Copied</dt><dd>{message.cc.join(", ")}</dd></>}
          {!!message.replyTo?.length&&<><dt>Replies go to</dt><dd>{message.replyTo.join(", ")}</dd></>}
        </dl></details>}
        {received&&<p className="hub-preserve">{message.body.slice(0,240)}{message.body.length>240?"…":""}</p>}
        {(!received||message.body.length>240)&&<details><summary>Read full message</summary><p className="hub-preserve">{message.body}</p></details>}
      </article>;
    }):<p className="hub-muted">No messages recorded yet. Request an interview to queue a booking invitation, or write an email.</p>}
  </section>;
}
