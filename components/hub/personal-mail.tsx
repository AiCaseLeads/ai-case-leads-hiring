"use client";
import { safeNavigation, useHubMutation, useHubResource } from "./api";
import { Badge, Feedback, ResourceState } from "./shared";
import type { Member } from "./types";

type MailStatus = { email:string; configured:boolean; connected:boolean; connectedAt:number|null; candidateAccount:string|null; candidateConnected?:boolean; canConnect?:boolean };
export function PersonalMailSetup({ member, refresh = 0 }: { member:Member; refresh?:number }) {
  const blocked = member.email.toLowerCase() === "sales@aicaseleads.com";
  const resource = useHubResource<MailStatus>("/api/personal-mail", refresh), mutation = useHubMutation();
  async function connect() {
    const result = await mutation.run<{url:string}>("/api/personal-mail/connect", "POST", {}, "Opening your Google email authorization…");
    if (result?.url && safeNavigation(result.url)) window.location.assign(result.url);
  }
  return <section className="hub-card" aria-labelledby="personal-mail-title">
    <div className="hub-section-heading compact"><div><h3 id="personal-mail-title">Recruiting email</h3><p>{blocked ? "Your account is excluded from applicant mail." : "Send recruiter conversations from your own Google Workspace account."}</p></div>
      {!blocked && resource.data && <Badge tone={resource.data.connected ? "success" : "warning"}>{resource.data.connected ? "Connection saved" : "Connection needed"}</Badge>}
    </div>
    <ResourceState loading={resource.loading} error={resource.error} retry={() => void resource.reload()} />
    {blocked ? <>
      <p className="hub-muted">Automatic receipts and rejections use SendGrid. Recruiter conversations use the recruiter selected on each job. Manage automatic email under Settings → Integrations → Automatic email.</p>
      <details className="hub-setup-details"><summary>Why this account cannot connect email</summary><p className="hub-muted">This login’s company Drive and fallback Calendar connection is separate. Connecting company Google does not subscribe you to job notifications or send applicant email from this account.</p></details>
    </> : <>
      <p className="hub-muted">Your account: <strong>{member.email}</strong>. This connection is for your recruiter conversations. Automatic receipts and rejections use SendGrid.</p>
      {resource.data && !resource.data.configured && <p className="hub-notice hub-error" role="alert">The owner needs to complete Google app configuration before you can connect.</p>}
      <div className="hub-button-row"><button className="hub-button" disabled={!resource.data?.configured || mutation.busy} onClick={() => void connect()}>{mutation.busy ? "Opening Google…" : resource.data?.connected ? "Reconnect recruiting email" : "Connect recruiting email"}</button><button className="hub-text-button" onClick={() => void resource.reload()}>Refresh saved status</button></div>
      <Feedback error={mutation.error} success={mutation.success} />
      <details className="hub-setup-details"><summary>What Google permissions allow</summary><ol><li>Choose the same Google account you used to sign in.</li><li>Approve Gmail sending, reading, sender settings, and verified email access. Mailbox read permission allows sent-message checks that help prevent duplicate sends.</li></ol><p className="hub-muted">Google’s permission applies to your mailbox. Connection alone does not confirm delivery or enable automatic inbox synchronization. Recruiter conversations and applicant replies stay in your Gmail. You do not need to create a no-reply alias.</p></details>
    </>}
  </section>;
}
