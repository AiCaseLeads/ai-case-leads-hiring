# Automatic applicant email

Application receipts and automatic screening rejections use **SendGrid**, with
**AI Case Leads Recruiting <no-reply@notify.aicaseleads.com>** as the company sender.
They do not use Maria’s Gmail account or the owner’s mailbox. They include no
staff CC or BCC.

Recruiters still connect their own Google account under **Settings → My
connections** for personal conversations and interviews. Their calendars and
the shared Google Drive archive remain unchanged.

## One-time connection

1. Open your existing [SendGrid account](https://app.sendgrid.com). Complete any
   pending account approval required for sending.
2. In **Settings → Sender Authentication**, add **notify.aicaseleads.com**. Add the exact DNS
   authentication records SendGrid supplies in **IONOS**, then wait for SendGrid to
   verify them. Add a **Null MX** record on **notify** with priority **0** and
   target **.** to reject incoming mail to that subdomain. Keep the main
   **aicaseleads.com** domain’s existing Google Workspace mail records unchanged.
3. The app’s sender is **AI Case Leads Recruiting
   <no-reply@notify.aicaseleads.com>**. Domain authentication must pass before
   it is ready. An authenticated sending domain does not require a new Gmail
   mailbox or a Gmail “Send mail as” alias.
4. Create or use a restricted SendGrid API key with **Mail Send** and **Domain
   Authentication read** access. If your account supports it, **Email Activity
   read-only** access can help reconcile uncertain delivery. Save the key
   directly in the hiring app’s **Railway →
   Variables → SENDGRID_API_KEY** field. Redeploy so the running service receives
   it. Keep the key private; do not put it in Git, screenshots, or chat.
5. Enable SendGrid’s **signed Event Webhook**, sending delivery events to
   **https://jobs.aicaseleads.com/api/webhooks/sendgrid**. Save its public
   verification key in Railway as **SENDGRID_WEBHOOK_PUBLIC_KEY** and redeploy.
   Signed events provide delivery confirmation without buying Email Activity
   access. Keep optional **SENDGRID_EMAIL_ACTIVITY_ENABLED=false** unless that
   access is already included in your approved account plan.
6. In the hiring hub, open **Settings → Company → Automatic applicant emails**
   and click **Check automatic email**. The owner and head recruiter can see
   this status. Only the server uses the API key.

## Verify before recovering earlier emails

- Send one controlled synthetic application to an address the team owns.
- Check the actual received **From** and **Reply-To** headers; both automatic
  identities must be the company no-reply address. Check that no recruiter or
  owner address appears in the headers or message body.
- Confirm the application and its PDF archive remain available independently
  of the email result. Check the provider message ID and delivery activity.
- Test a synthetic below-minimum application and confirm exactly one rejection
  message, with the same private automatic sender.
- In **Delivery activity → Retry earlier failed emails**, choose the date and
  preview. Review the exact messages, then retry the eligible batch. Sent and
  uncertain deliveries remain excluded; uncertain Gmail deliveries must be
  reconciled with Gmail, rather than blindly resent through SendGrid.

A successful sender check verifies the connection and sender configuration.
It does not prove delivery to an inbox; the controlled test does.

## Replies and limits

SendGrid handles outgoing mail. The dedicated **notify.aicaseleads.com**
subdomain’s **Null MX (0 .)** record tells sending servers that it accepts no
incoming email. Verify a controlled reply bounces before claiming this is
working. No Google mailbox, alias, or Admin changes are needed. Recruiter
conversations can receive replies in the recruiter’s own Gmail.

The app’s configured sending budget appears in the setup card. The initial
budget is **300 automatic emails per day**, independent of your SendGrid
account’s actual allowance. This does not assert a free-tier limit or change
your existing subscription. An application receipt and a later
automatic rejection count as separate messages. A large burst may therefore
delay email while applications continue to be accepted and archived. Excess
messages remain queued and are processed when capacity is available again.
Monitor the queue and the actual SendGrid account allowance; a subscription
change is a separate business decision.

Changing provider configuration does not automatically release held
historical email. Recover it explicitly after verification. If account access,
sender verification, or the API key fails, automatic messages remain held;
they must not fall back to a recruiter’s Gmail.
