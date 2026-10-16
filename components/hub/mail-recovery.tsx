"use client";
import { useState } from "react";
import { useHubMutation } from "./api";
import { Feedback } from "./shared";
import type { RecoveryPreview } from "../../lib/hub/mail-recovery";

function bogotaDay() {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: "America/Bogota", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date());
  const part = (type: string) => parts.find(value => value.type === type)?.value;
  return `${part("year")}-${part("month")}-${part("day")}`;
}
export function MailRecovery({ changed }: { changed: () => void }) {
  const [day, setDay] = useState(bogotaDay), [preview, setPreview] = useState<RecoveryPreview | null>(null), mutation = useHubMutation();
  async function inspect() {
    setPreview(null);
    const from = Date.parse(`${day}T00:00:00-05:00`);
    if (!Number.isFinite(from)) return;
    const result = await mutation.run<RecoveryPreview>("/api/hub/mail-recovery/preview", "POST", { from, to: from + 86400_000 }, "Email readiness checked. Review the recovery preview.");
    if (result) setPreview(result);
  }
  async function recover() {
    if (!preview?.planId || !preview.digest) return;
    const result = await mutation.run<{ queued: number; alreadyQueued: boolean }>("/api/hub/mail-recovery/execute", "POST", { planId: preview.planId, digest: preview.digest }, "Reviewed emails queued. Delivery status updates as the worker sends them.");
    if (result) { setPreview(null); changed(); }
  }
  return <section className="hub-card hub-mail-recovery" aria-labelledby="mail-recovery-title">
    <div className="hub-section-heading compact"><div><h3 id="mail-recovery-title">Retry earlier failed emails</h3><p>Check the email provider and sender, then queue eligible messages together. Application receipts are recovered first.</p></div></div>
    <div className="hub-button-row"><label className="hub-field">Email date · Bogotá time<input type="date" value={day} onChange={event => { setDay(event.target.value); setPreview(null); mutation.clear(); }} disabled={mutation.busy} /></label><button type="button" className="hub-button secondary" onClick={() => void inspect()} disabled={mutation.busy || !day}>{mutation.busy ? "Checking…" : "Preview failed emails"}</button></div>
    <Feedback error={mutation.error} success={mutation.success} />
    {preview && <div aria-live="polite">
      <p><strong>{preview.eligible} emails ready to retry.</strong>{preview.remaining > 0 ? ` ${preview.remaining} more can be reviewed in the next batch.` : ""}</p>
      <p className="hub-muted">Application receipts send from <strong>{preview.automaticSender}</strong> through SendGrid, with no staff CC or BCC. Incoming reply rejection must be verified on the dedicated notify subdomain. Previously requested recruiter conversations use the recruiter’s mailbox.</p>
      {Object.keys(preview.counts).length > 0 && <ul>{Object.entries(preview.counts).map(([kind, count]) => <li key={kind}>{kind}: {count}</li>)}</ul>}
      {preview.skipped.length > 0 && <details className="hub-setup-details"><summary>Why some emails are excluded</summary><ul>{preview.skipped.map(item => <li key={item.reason}>{item.reason}: {item.count}</li>)}</ul></details>}
      {preview.messages.length > 0 && <details className="hub-setup-details"><summary>Review the {preview.messages.length} {preview.messages.length === 1 ? "message" : "messages"} in this batch</summary><div className="hub-table-wrap"><table className="hub-table"><thead><tr><th scope="col">Applicant</th><th scope="col">Job</th><th scope="col">Message</th><th scope="col">From / Reply-To</th></tr></thead><tbody>{preview.messages.map(item => <tr key={item.id}><td>{item.applicant}</td><td>{item.job}</td><td>{item.kind}<span className="hub-secondary-line">{item.subject}</span></td><td>{item.sender}<span className="hub-secondary-line">Reply-To: {item.replyTo.join(", ") || item.sender}</span></td></tr>)}</tbody></table></div></details>}
      {preview.eligible > 0 && <div className="hub-button-row"><button type="button" className="hub-button" onClick={() => void recover()} disabled={mutation.busy}>Retry {preview.eligible} reviewed emails</button><button type="button" className="hub-text-button" onClick={() => setPreview(null)} disabled={mutation.busy}>Cancel preview</button></div>}
      <p className="hub-muted">Sent, uncertain, cancelled and active deliveries are excluded. This preview expires in 10 minutes; changes to a message or applicant require a new preview.</p>
    </div>}
  </section>;
}
