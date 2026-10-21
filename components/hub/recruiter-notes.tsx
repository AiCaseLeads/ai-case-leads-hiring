import type { ApplicationDetail } from "./types";
import { useHubMutation, displayDate } from "./api";
import { Badge, Feedback } from "./shared";

export function RecruiterNotes({detail,busy=false,addNote,changed}:{detail:ApplicationDetail;busy?:boolean;addNote:()=>void;changed:()=>void}) {
  const mutation=useHubMutation();
  const review=detail.notesReview;
  async function markReviewed(){
    if(!review?.hasUnread||busy||mutation.busy)return;
    const result=await mutation.run(`/api/hub/applications/${encodeURIComponent(detail.id)}/notes-reviewed`,"POST",{expectedNotesVersion:review.version},"Current notes marked reviewed by you.");
    if(result!==undefined)changed();
  }
  return <section className="hub-card hub-candidate-notes">
    <div className="hub-section-heading compact"><h3>Recruiter notes</h3><div className="hub-button-row">
      {review?.count ? <Badge tone={review.hasUnread?"warning":"success"}>{review.hasUnread?"New notes to review":"Reviewed by you"}</Badge>:null}
      {!!review?.hasUnread&&<button type="button" className="hub-button secondary" disabled={busy||mutation.busy} onClick={()=>void markReviewed()}>{mutation.busy?"Saving…":"Mark reviewed"}</button>}
      <button type="button" className="hub-text-button" disabled={busy||detail.trashed} onClick={addNote}>Add note</button>
    </div></div>
    <Feedback error={mutation.error} success={mutation.success}/>
    {review?.reviewedAt&&!review.hasUnread&&<p className="hub-muted">Reviewed by you {displayDate(review.reviewedAt)}. New notes will need a new review.</p>}
    {detail.notes.length?detail.notes.map(note=><article className="hub-history-item" key={note.id}><strong>{note.actor}</strong><small> · {displayDate(note.createdAt)}</small>{note.text.length>500?<details><summary>Read note</summary><p className="hub-preserve">{note.text}</p></details>:<p className="hub-preserve">{note.text}</p>}</article>):<p className="hub-muted">No notes yet. Add first-interview feedback before sending this applicant for founder review.</p>}
  </section>;
}
