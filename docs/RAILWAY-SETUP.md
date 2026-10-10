# Railway deployment and owner setup

This is the standalone Railway edition. The existing Sites deployment is unchanged. Railway stores authoritative hiring records in SQLite and original uploads in private files on one persistent volume. Gmail, Calendar/Meet, and Drive use Google Workspace. Staff sign-in uses Google; applicants need no account.

Deployment preparation is not a live launch. Google authorization, Railway volume persistence, the owner’s job-posting rehearsal, and final DNS/TLS checks must pass before opening intake.

## 1. Your account and Mariam’s account

`sales@aicaseleads.com` is the configured owner login. You can administer the deployment and the Google Cloud project with the appropriate permissions. Managers can be added as administrators in **Team & settings**.

`mariam@aicaseleads.com` remains the selected recruiting sender. Workspace ownership does not supply permission to her mailbox. While signed in to the hub as sales, use **Connect Google Workspace**, select Mariam’s Google account in the consent window, and have her authorize access. Keep the hub’s staff session signed in as sales. This separate grant lets the service send and read recruiting mail, create Calendar/Meet invitations, and archive files under the chosen Drive root. Do not share her password or paste secrets into chat.

If you prefer sales to perform all recruiting activity, change `EXPECTED_RECRUITING_EMAIL` to `sales@aicaseleads.com` in Railway and redeploy, then authorize sales in the recruiting connection. Existing grants are sender-specific; reconnect after changing this setting. The current implementation uses user OAuth and does not implement domain-wide delegation.

[Google describes user authorization and administrator-managed domain-wide delegation separately.](https://developers.google.com/workspace/guides/create-credentials)

## 2. Create the Railway service and volume

1. Upload this source to a **private GitHub repository** and create a Railway service from that repository. Alternatively, extract the supplied source archive, install the Railway CLI, link your own Railway project, and run `railway up` from the extracted project root. Do not upload `.env`, local databases, private files, or `node_modules`.
2. Name the service **`hiring-hub`**. Railway detects the root `Dockerfile`. Its build command is `npm run build:railway` and its runtime command is `npm run start:railway`. Node 24 is required. In Railway’s deployment settings, set **healthcheck `/api/health`**, timeout **300 seconds**, restart policy **Always**, and a **55-second shutdown/drain window**. New services no longer read `railway.json`; optional supported IaC is included in [`.railway/README.md`](../.railway/README.md).
3. Name the volume **`hiring-data`** and attach it to this service at **`/data`**. Set `DATA_DIR=/data`. Railway supplies its mount-path variable automatically; do not fake it. Choose capacity for resumes and attachments and set a storage-usage alert. The database and private uploads must survive a restart and a redeploy. Do not deploy without this volume or use an ephemeral directory.
4. Use **one replica** and keep the service running continuously. Disable sleeping/serverless behavior because the queue processor runs inside the service. This edition is not designed for multiple app instances sharing SQLite.
5. Generate a Railway HTTPS domain in **Settings → Networking**. Use it for setup and controlled tests before moving the public domain.
6. Set the variables below, then deploy. Migrations run at startup after the volume is mounted. No database credential, Cloudflare D1/R2 binding, Ashby account, Trigger.dev account, or separate email vendor is required.

Railway volumes are mounted at runtime, do not support replicas, and cause a short redeploy interruption while the volume changes deployments. [Railway volume reference](https://docs.railway.com/volumes/reference). Railway builds the project’s Dockerfile. [Docker builds](https://docs.railway.com/builds/dockerfiles).

## 3. Set Railway Variables

Copy names and ordinary values from `.env.railway.example`. Enter secrets directly into Railway Variables.

| Variable | Value / purpose |
| --- | --- |
| `DATA_DIR` | `/data`; the attached volume mount |
| `PUBLIC_SITE_ORIGIN` | Your generated Railway HTTPS origin, without a path or trailing slash |
| `ADMIN_EMAILS` | `sales@aicaseleads.com`; explicit owner access |
| `EXPECTED_RECRUITING_EMAIL` | `mariam@aicaseleads.com`, unless you choose sales instead |
| `GOOGLE_CLIENT_ID` | The Google Web application OAuth client ID created below |
| `GOOGLE_CLIENT_SECRET` | The same client’s secret; server-only |
| `GOOGLE_TOKEN_KEY` | 32 cryptographically random bytes encoded as 64 hexadecimal characters; securely back it up |
| `APPLICATIONS_ENABLED` | `false` throughout setup; change to exact `true` only for the controlled test and approved launch |
| `BACKGROUND_ENABLED` | `true`; built-in task processing |

The start command sets Railway mode. Railway supplies `PORT`; the server listens on `0.0.0.0`. Keep the encryption key stable after connection. Losing or replacing it makes saved Google credentials unreadable and requires reconnecting. Do not copy credentials from the current Sites deployment: this is a separate installation with its own database and grant.

To generate an encryption key locally, run this once and paste the result directly into Railway Variables; keep it out of screenshots, commits, and chat:

```sh
node -e "process.stdout.write(require('node:crypto').randomBytes(32).toString('hex'))"
```

## 4. Create the Google client

1. In [Google Cloud Console](https://console.cloud.google.com/), create or select the company recruiting project. Enable **Gmail API**, **Google Calendar API**, and **Google Drive API**.
2. Configure Google Auth Platform branding and audience. Use **Internal** for your Workspace organization when eligible. Allow the app in Workspace Admin if your organization blocks third-party app access. Staff login needs `openid email profile`; the separate recruiting grant requests Gmail, Calendar, and Drive access.
3. Create a **Web application** OAuth client. Add these two authorized redirect URIs, replacing `YOUR-SERVICE.up.railway.app` with the generated domain:

```text
https://YOUR-SERVICE.up.railway.app/api/auth/google/callback
https://YOUR-SERVICE.up.railway.app/api/google/callback
```

4. Enter its client ID and secret in Railway Variables and redeploy. They are shared by the two separate authorization flows, remain on the server, and are never displayed by the hiring status API.
5. Open `/team`, select **Sign in with Google**, and choose `sales@aicaseleads.com`. Unknown users do not become administrators. Add managers/recruiters explicitly in **Team & settings**.
6. In **Team & settings → Google connection setup**, confirm the expected sender. Select **Connect Google Workspace** and authorize the chosen recruiting account. Confirm the connected sender afterward.

The callback addresses must match exactly. Staff identity does not authorize recruiting services. [Google web-server OAuth](https://developers.google.com/identity/protocols/oauth2/web-server), [Google sign-in validation](https://developers.google.com/identity/openid-connect/openid-connect).

## 5. Calendar, Drive, and background tasks

Create or choose a recruiting calendar. The recruiting Google account must be able to create and modify its events. Copy **Calendar settings → Integrate calendar → Calendar ID** into the hub. Save the actual time zone, weekdays, hours, and interview duration; confirm these instead of accepting an assumed schedule.

Create a private recruiting Drive root folder and give the recruiting account access to create folders and files inside it. Paste its folder ID into the hub. Public `anyone`-shared roots are rejected. Candidate data and original files remain private on Railway; Drive receives a secondary archive organized by job and separate application identity.

The Node service runs the queue without Apps Script. **Integration tasks** shows task outcomes, failed/uncertain deliveries, and worker health. Google outages leave accepted applications in the database. Fix the connection and retry failed tasks through the hub. Uncertain Gmail sends are searched by their exact message identity and are never automatically resent. Review the recorded outcome before authorizing any new message.

Do not install the old Sites Apps Script scheduler for this edition. Keep **automatic rejection and interview reminders disabled** until their specific tests and requirements are approved.

## 6. Post a job and test the complete flow

1. As sales, open **Overview → Create the two draft roles** if the database is empty. Open **Roles & forms** and edit one draft’s description, application questions, assessment prompt, and approved qualification rules. Save, reopen, and confirm persistence.
2. Open the job, set `APPLICATIONS_ENABLED=true`, and redeploy for a short controlled test using the temporary Railway domain. Open the applicant website in a signed-out browser and confirm the role appears. Use a clearly labeled test application and an inbox you control.
3. Upload a sample resume, submit, and confirm the receipt. Repeated clicks/retries must create one application and one initial email decision. Verify the application appears in the private hub with the correct job, answers, source, and file. Anonymous visitors must not see the application or private file.
4. Check confirmation email delivery and Drive archival. Add an internal note and reopen the profile. Record a manager scorecard and verify the displayed score and reviewer. Review qualification evidence against your configured rules.
5. Explicitly start the assessment and complete its emailed link. Explicitly invite the candidate to an interview, check time zones and availability, book it, verify the Calendar event/Meet link, reschedule, then cancel. Confirm the matching event and history update. Test rejection using your own test inbox and verify one email for one decision.
6. Restart and redeploy the service with the same volume. Verify that the test job, application, scorecard, original upload, and Drive links remain. Confirm a queued task resumes. Enable and test backups below.
7. Set intake back to `false` if any check fails or setup remains incomplete. Clean up test records deliberately; never run destructive resets against production.

Local automated checks cannot verify an actual Google consent grant, provider quotas, delivery, Railway disk persistence, owner permissions, or DNS. Those remain live acceptance checks.

## 7. How grading works

Qualification rules use the answers to your approved job-specific questions. They label which configured requirements pass or fail and show the reason. Automatic rejection starts disabled. No AI decides who is hired or who receives an interview.

Managers record a 1–5 scorecard with supporting notes. The dashboard uses each reviewer’s **latest** score and displays the average out of 5 with its reviewer count. For example, scores 4 and 5 produce **4.5/5**. The underlying data also provides an equivalent **90/100**, calculated by multiplying that average by 20. Revising your own score replaces your previous contribution instead of counting another vote. An applicant without a scorecard remains unreviewed; a high score helps prioritize human review and does not send an invitation automatically.

Approve a shared rubric before comparing applicants: job-relevant evidence, example work, assessment quality, and role-specific skills. Enter mandatory criteria as qualification rules and use consistent scorecard anchors. This version has no opaque AI ranking and does not invent requirements.

## 8. Backups, recovery, and the public domain

Enable Railway volume backups and choose a retention schedule. Test a restore into a separate staging service before launch. The database, original-file directory, and encryption key all matter; Drive archives do not replace the authoritative database. Use the included SQLite backup command for an online-consistent database snapshot; do not copy just `hiring.sqlite` while WAL writes are active. Treat every backup as private candidate data.

From a Railway shell inside the running container, create a new dated snapshot without overwriting an existing file:

```sh
DATA_DIR=/data node scripts/railway-backup.mjs /data/backups/hiring-YYYY-MM-DD.sqlite
```

Replace the date placeholder. This captures SQLite including committed WAL data; `/data/objects` still needs the volume backup. A snapshot stored on the same volume alone does not protect against losing that volume. Use Railway backups and store an encrypted recovery copy in a separate private location. Restore tests must include files and the separately held encryption key.

Keep this service on one replica. For larger multi-instance operation, plan a separate migration to a shared database/object store instead of mounting SQLite on multiple services.

After the controlled test and review gate pass, add **`jobs.aicaseleads.com`** to Railway’s custom domains. Use the exact DNS record Railway supplies. Remove/replace the old Sites routing for this hostname only after confirming the cutover; do not reuse the Sites CNAME or guess Railway’s target. Update `PUBLIC_SITE_ORIGIN=https://jobs.aicaseleads.com`, add both custom-domain callback URIs to the same Google client, and redeploy. Revalidate staff login, applicant links, email, Calendar, Drive, and HTTPS on the final hostname. If the Google client or sender changes, reconnect the recruiting grant.

Keep the Railway-domain callbacks during rollback preparation. If a release fails, redeploy the previous code against the same volume only when its migrations are compatible, or restore a tested private backup into staging first. Never attach two live instances to the same SQLite volume.

[Railway public networking and domain setup](https://docs.railway.com/networking/public-networking), [Railway backups](https://docs.railway.com/volumes/backups).
