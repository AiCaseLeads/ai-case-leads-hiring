"use client";
import { displayDate, useHubResource } from "./api";
import { Badge, ResourceState } from "./shared";

export type AutomaticMailStatus = {
  provider: "sendgrid";
  sender: string;
  replyTo?: string;
  configured: boolean;
  ready: boolean;
  error: string | null;
  checkedAt: number | null;
  dailyLimit: number;
  setupUrl: "https://app.sendgrid.com";
};

export function automaticMailExplanation(error: string) {
  if (error.includes("api_key") || error.includes("key_required") || error.includes("not_configured")) return "Add the SendGrid API key to the hiring service’s Railway variables.";
  if (error === "transactional_mail_dns_check_failed") return "The reply-domain DNS check is temporarily unavailable. Emails stay queued and retry automatically; applications remain saved.";
  if (error === "transactional_mail_reply_domain_not_verified") return "Add and verify a Null MX record (priority 0, target .) on notify.aicaseleads.com in IONOS so applicant replies cannot reach a staff inbox.";
  if (error.includes("domain")) return "Authenticate aicaseleads.com in SendGrid using the DNS records it provides.";
  if (error.includes("sender")) return "Authenticate the aicaseleads.com sending domain in SendGrid for no-reply-recruiting@aicaseleads.com.";
  if (error.includes("disabled") || error.includes("suspended") || error.includes("account")) return "Check SendGrid’s account approval and transactional email access.";
  if (error.includes("auth") || error.includes("credential")) return "Check the SendGrid API key in Railway; it may have expired or been revoked.";
  return "Check the SendGrid connection and sender under Settings → Company.";
}

export function AutomaticMailSetup({ refresh = 0 }: { refresh?: number }) {
  const resource = useHubResource<AutomaticMailStatus>("/api/transactional-mail", refresh);
  const status = resource.data;
  return <section className="hub-card" aria-labelledby="automatic-mail-title">
    <div className="hub-section-heading compact"><div><h3 id="automatic-mail-title">Automatic applicant emails</h3><p>SendGrid sends application receipts and automatic rejections from your company address.</p></div>
      {status && <Badge tone={status.ready ? "success" : "warning"}>{status.ready ? "Sender verified" : status.error === "transactional_mail_dns_check_failed" ? "Verification unavailable" : status.configured ? "Setup incomplete" : "Not connected"}</Badge>}
    </div>
    <ResourceState loading={resource.loading} error={resource.error} retry={() => void resource.reload()} />
    <p className="hub-muted">Sender: <strong>{status?.sender || "no-reply-recruiting@aicaseleads.com"}</strong>. Reply-To: <strong>{status?.replyTo || "no-reply@notify.aicaseleads.com"}</strong>.</p>
    {status?.error && <p className="hub-notice hub-error" role="alert">{automaticMailExplanation(status.error)}</p>}
    <div className="hub-button-row"><button className="hub-button secondary" type="button" disabled={resource.loading} onClick={() => void resource.reload()}>{resource.loading ? "Checking…" : "Check automatic email"}</button><a className="hub-text-button" href="https://app.sendgrid.com" target="_blank" rel="noopener noreferrer">Open SendGrid</a></div>
    <details className="hub-setup-details"><summary>Connect automatic email · one-time setup</summary><p className="hub-muted">This dedicated reply address requires a verified Null MX record to reject incoming mail. Recruiters’ Gmail accounts and calendars stay separate; no Gmail alias or mailbox is needed to send through SendGrid.</p><ol>
      <li>Open your existing SendGrid account, then <strong>Settings → Sender Authentication</strong>.</li>
      <li>Verify <strong>aicaseleads.com</strong> under SendGrid Sender Authentication. The app sends from <strong>no-reply-recruiting@aicaseleads.com</strong>. Keep the domain’s existing Google mail records unchanged.</li>
      <li>Use <strong>no-reply@notify.aicaseleads.com</strong> for Reply-To. Add a Null MX record (<code>0 .</code>) on <strong>notify</strong> in IONOS to reject incoming replies. The From address has no staff mailbox or alias. Test that mail addressed directly to it bounces rather than reaching a catch-all inbox before recovering earlier emails.</li>
      <li>Create or use a restricted SendGrid API key with <strong>Mail Send</strong> and <strong>Domain Authentication read</strong> access. Add it privately to the hiring service in Railway as <code>SENDGRID_API_KEY</code>, then redeploy. Never paste the key in chat.</li>
      <li>Enable SendGrid’s <strong>signed Event Webhook</strong> for <code>https://jobs.aicaseleads.com/api/webhooks/sendgrid</code>. Save its public verification key in Railway as <code>SENDGRID_WEBHOOK_PUBLIC_KEY</code> so delivery events can be verified.</li>
      <li>Click <strong>Check automatic email</strong>. After sender verification, send a controlled test and review its delivery before retrying held applicant emails in Delivery activity.</li>
    </ol><p className="hub-muted">App sending budget: {status?.dailyLimit || 300} emails per day. Your SendGrid plan may have a different allowance. Excess emails remain queued for later processing; accepted applications remain saved. Automatic messages include no recruiter CC or BCC. Use a Null MX record on the dedicated notify subdomain to reject incoming replies, then test a reply to confirm the bounce.</p></details>
    {status?.checkedAt && <p className="hub-muted">Last sender check: {displayDate(status.checkedAt)}. A successful check confirms setup; the controlled test confirms delivery.</p>}
  </section>;
}

export function AutomaticMailNotice({ refresh = 0 }: { refresh?: number }) {
  const resource = useHubResource<AutomaticMailStatus>("/api/transactional-mail", refresh);
  if (!resource.data || resource.data.ready) return null;
  if (resource.data.error === "transactional_mail_dns_check_failed") return <p className="hub-notice">The automatic email DNS check is temporarily unavailable. Messages stay queued and retry automatically; applications and files remain saved.</p>;
  return <p className="hub-notice">Automatic applicant emails need SendGrid setup under <strong>Settings → Company</strong>. Recruiter conversations use each recruiter’s own connected Gmail. Applicant records stay saved while automatic emails are held. <a className="hub-text-button" href="/team?view=settings&section=company">Open automatic email setup</a></p>;
}
