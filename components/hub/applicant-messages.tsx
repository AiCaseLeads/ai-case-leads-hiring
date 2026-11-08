import type { ApplicationDetail } from "./types";
import { Badge } from "./shared";
import { displayDate } from "./api";
import { communicationSummary } from "./activity-summary";

export function ApplicantMessages({detail,busy,compose}:{detail:ApplicationDetail;busy:boolean;compose:()=>void}) {
 return <section className="hub-card hub-applicant-messages" aria-labelledby="applicant-messages-title"><div className="hub-section-heading compact"><h3 id="applicant-messages-title">Messages</h3><button type="button" className="hub-button secondary" disabled={busy||detail.trashed} onClick={compose}>Write email</button></div>
 <p className="hub-muted">Conversation from the connected recruiting mailbox.</p><div className="hub-message-list">{detail.communications.length?[...detail.communications].sort((a,b)=>b.createdAt-a.createdAt).map(message=>{
 const received=message.direction==="incoming"||message.status==="received",state=received?{label:"Received",explanation:"A received message was recorded for this application."}:communicationSummary(message.status);
 const automatic=!received&&['acknowledgment','acknowledgement','receipt','rejection','reminder'].some(term=>(message.purpose||'').toLowerCase().includes(term));
 return <article className={'hub-message-row'+(received?' incoming':' outgoing')} key={message.id}><div className="hub-message-heading"><strong>{message.subject||message.purpose||"Email"}</strong><Badge tone={received?'success':message.status==='failed'?'warning':'neutral'}>{state.label}</Badge></div><div className="hub-message-meta"><span>{received?'Incoming':'Outgoing'}</span><time dateTime={new Date(message.createdAt).toISOString()}>{displayDate(message.createdAt)}</time>{message.sender&&<span>{message.sender}</span>}</div>
 {received&&<p className="hub-message-body">{message.body.slice(0,320)}{message.body.length>320?'…':''}</p>}
 <details className="hub-message-details"><summary>{automatic?'View automatic email':received?'Message details':'View email and delivery details'}</summary><p className="hub-muted">{state.explanation}</p><dl className="hub-message-envelope">{message.sender&&<><dt>From</dt><dd>{message.sender}</dd></>}{!!message.to?.length&&<><dt>To</dt><dd>{message.to.join(', ')}</dd></>}{!!message.cc?.length&&<><dt>CC</dt><dd>{message.cc.join(', ')}</dd></>}{!!message.replyTo?.length&&<><dt>Reply-to</dt><dd>{message.replyTo.join(', ')}</dd></>}</dl>{(!received||message.body.length>320)&&<p className="hub-message-body">{message.body}</p>}</details></article>;
 }):<p className="hub-muted">No messages recorded yet.</p>}</div></section>;
}
