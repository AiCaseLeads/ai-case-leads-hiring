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
    <div className="hub-section-heading compact"><div><h3 id="personal-mail-title">Recruiting email</h3><p>{blocked ? "Applicant messages use the recruiting account assigned to automated email." : "Send recruiter conversations from your own Google Workspace account."}</p></div>
      {resource.data && <Badge tone={(blocked ? resource.data.candidateConnected : resource.data.connected) ? "success" : "warning"}>{(blocked ? resource.data.candidateConnected : resource.data.connected) ? "Account connected" : "Connection needed"}</Badge>}
    </div>
    <ResourceState loading={resource.loading} error={resource.error} retry={() => void resource.reload()} />
    {blocked ? <>
      <p className="hub-muted">Assigned account: <strong>{resource.data?.candidateAccount || "Not configured"}</strong>. {resource.data?.candidateConnected ? "Connected; sender verification and a test delivery confirm readiness." : "That recruiter must sign in and connect Gmail here."}</p>
      <button className="hub-button secondary" onClick={() => void resource.reload()}>Check recruiting email</button>
      <details className="hub-setup-details"><summary>Why this account cannot connect email</summary><p className="hub-muted">The owner requested that sales receive no applicant mail. This login’s company Drive and fallback Calendar connection is separate. Recruiting email must be approved by the assigned recruiter in their own account.</p></details>
    </> : <>
      <p className="hub-muted">Your account: <strong>{member.email}</strong>{resource.data?.candidateAccount ? ". Automatic applicant email is assigned to " + resource.data.candidateAccount + "." : "."}</p>
      {resource.data && !resource.data.configured && <p className="hub-notice hub-error" role="alert">The owner needs to complete Google app configuration before you can connect.</p>}
      <div className="hub-button-row"><button className="hub-button" disabled={!resource.data?.configured || mutation.busy} onClick={() => void connect()}>{mutation.busy ? "Opening Google…" : resource.data?.connected ? "Reconnect recruiting email" : "Connect recruiting email"}</button><button className="hub-text-button" onClick={() => void resource.reload()}>Check connection</button></div>
      <Feedback error={mutation.error} success={mutation.success} />
      <details className="hub-setup-details"><summary>Google permissions & automated sender setup</summary><ol><li>Choose the same Google account you used to sign in.</li><li>Approve Gmail sending, reading, sender settings, and verified email access. Mailbox read permission allows sent-message checks that help prevent duplicate sends.</li><li>If this account handles automatic applicant mail, add the approved no-reply alias in Gmail’s Send mail as settings, then send a controlled test through the hiring app.</li></ol><p className="hub-muted">Google’s permission applies to the mailbox. Connection alone does not confirm delivery or enable automatic inbox synchronization. Automated no-reply messages do not accept replies; recruiter conversations can receive replies in the recruiter’s Gmail.</p></details>
    </>}
  </section>;
}
