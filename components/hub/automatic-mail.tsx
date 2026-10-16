"use client";
import { displayDate, useHubResource } from "./api";
import { Badge, ResourceState } from "./shared";

export type AutomaticMailStatus = {
  provider: "brevo";
  sender: string;
  configured: boolean;
  ready: boolean;
  error: string | null;
  checkedAt: number | null;
  dailyLimit: number;
  setupUrl: "https://app.brevo.com";
};

export function automaticMailExplanation(error: string) {
  if (error.includes("api_key") || error.includes("not_configured")) return "Add the Brevo API key to the hiring service’s Railway variables.";
  if (error.includes("domain")) return "Authenticate notify.aicaseleads.com in Brevo using the DNS records it provides.";
  if (error.includes("sender")) return "Verify no-reply@notify.aicaseleads.com as an approved sender in Brevo.";
  if (error.includes("disabled") || error.includes("suspended") || error.includes("account")) return "Check Brevo’s account approval and transactional email access.";
  if (error.includes("auth") || error.includes("credential")) return "Check the Brevo API key in Railway; it may have expired or been revoked.";
  return "Check the Brevo connection and sender under Settings → Company.";
}

export function AutomaticMailSetup({ refresh = 0 }: { refresh?: number }) {
  const resource = useHubResource<AutomaticMailStatus>("/api/transactional-mail", refresh);
  const status = resource.data;
  return <section className="hub-card" aria-labelledby="automatic-mail-title">
    <div className="hub-section-heading compact"><div><h3 id="automatic-mail-title">Automatic applicant emails</h3><p>Brevo sends application receipts and automatic rejections from your company address.</p></div>
      {status && <Badge tone={status.ready ? "success" : "warning"}>{status.ready ? "Sender verified" : status.configured ? "Setup incomplete" : "Not connected"}</Badge>}
    </div>
    <ResourceState loading={resource.loading} error={resource.error} retry={() => void resource.reload()} />
    <p className="hub-muted">Sender: <strong>{status?.sender || "no-reply@notify.aicaseleads.com"}</strong>. Recruiters’ Gmail accounts and calendars stay separate; no Gmail alias or mailbox is needed for this sender.</p>
    {status?.error && <p className="hub-notice hub-error" role="alert">{automaticMailExplanation(status.error)}</p>}
    <div className="hub-button-row"><button className="hub-button secondary" type="button" disabled={resource.loading} onClick={() => void resource.reload()}>{resource.loading ? "Checking…" : "Check automatic email"}</button><a className="hub-text-button" href="https://app.brevo.com" target="_blank" rel="noopener noreferrer">Open Brevo</a></div>
    <details className="hub-setup-details"><summary>Connect automatic email · one-time setup</summary><ol>
      <li>Create a company-owned Brevo account and enable transactional email.</li>
      <li>Authenticate <strong>notify.aicaseleads.com</strong> in Brevo. Add its DNS records in IONOS and a Null MX record (<code>0 .</code>) on <strong>notify</strong> to reject incoming replies. Keep the main domain’s Google mail records unchanged. Then verify <strong>no-reply@notify.aicaseleads.com</strong> as the sender.</li>
      <li>Create a Brevo API key. Add it privately to the hiring service in Railway as <code>BREVO_API_KEY</code>, then redeploy. Never paste the key in chat.</li>
      <li>Click <strong>Check automatic email</strong>. After sender verification, send a controlled test and review its delivery before retrying held applicant emails in Delivery activity.</li>
    </ol><p className="hub-muted">{status?.dailyLimit || 300} emails per day are allowed by the configured queue limit. Large batches wait for capacity; accepted applications remain saved. Automatic messages include no recruiter CC or BCC. Use a Null MX record on the dedicated notify subdomain to reject incoming replies, then test a reply to confirm the bounce.</p></details>
    {status?.checkedAt && <p className="hub-muted">Last sender check: {displayDate(status.checkedAt)}. A successful check confirms setup; the controlled test confirms delivery.</p>}
  </section>;
}

export function AutomaticMailNotice({ refresh = 0 }: { refresh?: number }) {
  const resource = useHubResource<AutomaticMailStatus>("/api/transactional-mail", refresh);
  if (!resource.data || resource.data.ready) return null;
  return <p className="hub-notice">Automatic applicant emails need Brevo setup under <strong>Settings → Company</strong>. Recruiter conversations use each recruiter’s own connected Gmail. Applicant records stay saved while automatic emails are held. <a className="hub-text-button" href="/team?view=settings&section=company">Open automatic email setup</a></p>;
}
