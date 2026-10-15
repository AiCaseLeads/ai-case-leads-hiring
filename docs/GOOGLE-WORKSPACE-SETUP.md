# Google Workspace setup — Railway

The production hub is https://jobs.aicaseleads.com/team. The company connection remains responsible for Drive archival and the fallback Calendar. Recruiter-owned Gmail uses separate OAuth grants under **Settings → My setup → My recruiting email**. `CANDIDATE_MAIL_ACCOUNT=mariam@aicaseleads.com` selects Maria for automatic mail; she must authorize her own account and configure the approved no-reply alias in her Gmail. Sales cannot connect as a recruiting mail account.

Staff sign-in, personal Gmail, personal Calendar, and company storage consent are separate. Workspace ownership does not authorize another employee's mailbox. Historical verification notes describe their dated test state, not current mail ownership.

## Check the existing connection

1. Sign in as an approved administrator and open **Settings**. The guided Google steps show the company storage account, interview calendar and shared Drive folder.
2. Confirm the existing company storage account. Do not disconnect/recreate the working grant just to repeat setup.
3. Current approved temporary availability is Monday–Friday, 10:00–16:00 `America/Bogota`, 30-minute interviews. Confirm calendar editing rights before changing IDs, and resolve active/unresolved bookings first.
4. The shared recruiting root must permit the connected account to create folders/files and remain private. Archives use Recruiting → Job → Location → Posting → Applicant; existing application/folder identities are preserved.
5. Save calendar/Drive changes using **Save settings**. Inspect **Delivery activity** for actual completed or failed tasks; a connected status alone is not delivery evidence.

## Configure a fresh Railway environment

Use [Railway setup](RAILWAY-SETUP.md) for the full deployment procedure. Keep its intake paused until controlled acceptance tests pass.

1. In the company Google Cloud project, enable Gmail, Calendar and Drive APIs. Configure the Google Auth Platform audience as Internal when eligible; allow the app in Workspace Admin if required.
2. Create a Web application OAuth client with the exact environment-specific callbacks. Current production uses:

```text
https://jobs.aicaseleads.com/api/auth/google/callback
https://jobs.aicaseleads.com/api/google/callback
```

3. Save `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` privately in Railway Variables, with a stable backed-up `GOOGLE_TOKEN_KEY`. No secret belongs in source, browser code or chat. Replacing the encryption key invalidates saved encrypted credentials.
4. Set `ADMIN_EMAILS` to explicitly approved owners and `EXPECTED_RECRUITING_EMAIL=sales@aicaseleads.com` for the existing company storage connection. Redeploy, sign in through Google, then separately choose **Connect Google Workspace** and authorize the company storage account. Do not replace this grant to connect Maria’s mail.
5. Save the calendar ID, timezone/window/duration and private shared Drive root. The consent grant requires Gmail send/read, Calendar and Drive scopes plus offline access. [Google web-server OAuth](https://developers.google.com/identity/protocols/oauth2/web-server).
6. Use a controlled inbox/posting to verify delivery, availability/conflicts, Meet, booking changes/cancellation and archive identity. Complete the remaining [launch acceptance checks](LAUNCH-CHECKLIST.md), including reply/recovery and offer rehearsal.

## Connect Maria’s recruiting Gmail

Maria signs in using her invited work account, opens **Settings → My setup → My recruiting email**, and chooses **Connect recruiting email**. Consent requires Gmail send/read, sender-settings access, and verified identity; read access supports sent-message reconciliation to prevent duplicate deliveries. No Drive or Calendar scope is requested by this mail flow. Configure the approved no-reply alias in Maria’s Gmail Send mail as settings and verify a controlled delivery. No-reply replies must be rejected by Workspace routing. The owner’s dashboard shows Maria’s connection status but cannot authorize her Gmail.

Each recruiter separately connects their interview Calendar and saves availability. Existing interviews retain their original calendar identity. Do not modify the company Drive grant or `EXPECTED_RECRUITING_EMAIL` to connect personal mail.

## Processing and recovery

Railway's always-running Node service processes queued work automatically. **No Apps Script scheduler, Sites service token, D1 binding or R2 bucket is required.** The retained `workspace-scheduler.gs` is legacy Sites material and must not be installed for this deployment.

Accepted applications and originals save on Railway before Google tasks execute. On failure, fix the grant/access and retry safe failures from Delivery activity. Uncertain Gmail sends use exact Message-ID reconciliation rather than blind resend; uncertain Calendar work uses the existing event identity. Drive retries preserve reserved IDs and revision snapshots. Public Drive roots shared with `anyone` are rejected.

Full Drive OAuth access is broader than only the recruiting folder; this implementation does not use a Google Picker `drive.file` flow. Gmail read permission supports known-thread replies and uncertain-send reconciliation. Record any change of grant/root as an operational change and verify the intended account and private access.

Overdue-review reminders are staff-only and use the saved waiting period/fallback recipients; their first real email remains an acceptance check. Interview reminders are separate and default off: prove actual timed delivery and cancellation suppression before enabling them. [Google Workspace setup and credentials](https://developers.google.com/workspace/guides/create-credentials).
