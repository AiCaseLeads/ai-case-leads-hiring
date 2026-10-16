# Railway deployment and owner setup

The production installation is https://jobs.aicaseleads.com, with the private dashboard at `/team`. This guide also covers a fresh standalone Railway installation; do not reset or recreate the existing production service while following those steps. Railway stores authoritative hiring records in SQLite and original uploads in private files on one persistent volume. Gmail, Calendar/Meet, and Drive use Google Workspace. Automatic emails use SendGrid. Staff sign-in uses Google; applicants need no account.

The current deployment has dated evidence for Google authorization, volume persistence, guided private job setup, and custom-domain HTTPS. See [Railway verification](RAILWAY-VERIFICATION.md) and [Launch checklist](LAUNCH-CHECKLIST.md) for completed checks and remaining gates. A new environment needs its own tests before enabling intake.

## 1. Current owner and recruiting account

`sales@aicaseleads.com` remains the owner login and existing company Drive/fallback Calendar connection. It is not an applicant-mail transport. Recruiters authorize their own Gmail separately through **Settings → My setup → My recruiting email**, while signed in as themselves.

Automatic emails use the company's existing SendGrid account and `no-reply-recruiting@aicaseleads.com`, with Reply-To `no-reply@notify.aicaseleads.com`. SendGrid needs no Gmail alias or mailbox. Configure the restricted server key and DNS using [Automatic email setup](AUTOMATIC-EMAIL-SETUP.md). `CANDIDATE_MAIL_ACCOUNT` now selects only Gmail reply synchronization and legacy uncertain-message reconciliation. Do not replace the company Drive grant or change `EXPECTED_RECRUITING_EMAIL` to connect personal mail.

Each interviewer connects a personal calendar separately. Existing invitations retain their original organizer; the shared fallback calendar remains available. Workspace ownership does not authorize another employee’s mailbox. The app uses user OAuth, not domain-wide delegation.

[Google describes user authorization and administrator-managed domain-wide delegation separately.](https://developers.google.com/workspace/guides/create-credentials)

## 2. Create a new Railway service and volume

1. Upload this source to a **private GitHub repository** and create a Railway service from that repository. Alternatively, extract the supplied source archive, install the Railway CLI, link your own Railway project, and run `railway up` from the extracted project root. Do not upload `.env`, local databases, private files, or `node_modules`.
2. Name the service **`hiring-hub`**. Railway detects the root `Dockerfile`. Its build command is `npm run build:railway` and its runtime command is `npm run start:railway`. Node 24 is required. In Railway’s deployment settings, set **healthcheck `/api/health`**, timeout **300 seconds**, restart policy **Always**, and a **55-second shutdown/drain window**. New services no longer read `railway.json`; optional supported IaC is included in [`.railway/README.md`](../.railway/README.md).
3. Name the volume **`hiring-data`** and attach it to this service at **`/data`**. Set `DATA_DIR=/data`. Railway supplies its mount-path variable automatically; do not fake it. Choose capacity for resumes and attachments and set a storage-usage alert. The database and private uploads must survive a restart and a redeploy. Do not deploy without this volume or use an ephemeral directory.
4. Use **one replica** and keep the service running continuously. Disable sleeping/serverless behavior because the queue processor runs inside the service. This edition is not designed for multiple app instances sharing SQLite.
5. Generate a Railway HTTPS domain in **Settings → Networking**. Use it for setup and controlled tests before moving the public domain.
6. Set the variables below, then deploy. Migrations run at startup after the volume is mounted. No database credential, Cloudflare D1/R2 binding, Ashby account, Trigger.dev account, is required. SendGrid is the separate automatic email provider.

Railway volumes are mounted at runtime, do not support replicas, and cause a short redeploy interruption while the volume changes deployments. [Railway volume reference](https://docs.railway.com/volumes/reference). Railway builds the project’s Dockerfile. [Docker builds](https://docs.railway.com/builds/dockerfiles).

## 3. Set Railway Variables

Copy names and ordinary values from `.env.railway.example`. Enter secrets directly into Railway Variables.

| Variable | Value / purpose |
| --- | --- |
| `DATA_DIR` | `/data`; the attached volume mount |
| `PUBLIC_SITE_ORIGIN` | Current deployment: `https://jobs.aicaseleads.com`. New environment: its own HTTPS origin, without a path or trailing slash |
| `ADMIN_EMAILS` | `sales@aicaseleads.com`; explicit owner access |
| `EXPECTED_RECRUITING_EMAIL` | `sales@aicaseleads.com` for the existing company Drive/fallback Calendar connection |
| `GOOGLE_CLIENT_ID` | The Google Web application OAuth client ID created below |
| `GOOGLE_CLIENT_SECRET` | The same client’s secret; server-only |
| `GOOGLE_TOKEN_KEY` | 32 cryptographically random bytes encoded as 64 hexadecimal characters; securely back it up |
| `APPLICATIONS_ENABLED` | New environment: `false` during setup; enable exact `true` only for controlled tests/approved intake. Do not reset the existing production flag while following this guide |
| `BACKGROUND_ENABLED` | `true`; built-in task processing |
| `SENDGRID_API_KEY` | Restricted server key: Mail Send and Domain Authentication read |
| `SENDGRID_WEBHOOK_PUBLIC_KEY` | Public verification key for signed SendGrid delivery events |
| `AUTOMATIC_MAIL_DAILY_LIMIT` | App sending budget; defaults to `300`. Set within the existing account allowance |

The start command sets Railway mode. Railway supplies `PORT`; the server listens on `0.0.0.0`. Keep the encryption key stable after connection. Losing or replacing it makes saved Google credentials unreadable and requires reconnecting. A fresh installation needs its own database and authorization; do not copy credentials or overwrite the existing production installation while following this guide.

To generate an encryption key locally, run this once and paste the result directly into Railway Variables; keep it out of screenshots, commits, and chat:

```sh
node -e "process.stdout.write(require('node:crypto').randomBytes(32).toString('hex'))"
```

## 4. Create the Google client

1. In [Google Cloud Console](https://console.cloud.google.com/), create or select the company recruiting project. Enable **Gmail API**, **Google Calendar API**, and **Google Drive API**.
2. Configure Google Auth Platform branding and audience. Use **Internal** for your Workspace organization when eligible. Allow the app in Workspace Admin if your organization blocks third-party app access. Staff login needs `openid email profile`; the separate recruiting grant requests Gmail, Calendar, and Drive access.
3. Create a **Web application** OAuth client. Add these two authorized redirect URIs, using the current production addresses below (a new environment must use its own origin):

```text
https://jobs.aicaseleads.com/api/auth/google/callback
https://jobs.aicaseleads.com/api/google/callback
```

4. Enter its client ID and secret in Railway Variables and redeploy. They are shared by the two separate authorization flows, remain on the server, and are never displayed by the hiring status API.
5. Open `/team`, select **Sign in with Google**, and choose `sales@aicaseleads.com`. Unknown users do not become administrators. Add managers/recruiters explicitly in **Settings**.
6. In **Settings → Google connection setup**, confirm the expected sender. Select **Connect Google Workspace** and authorize the chosen recruiting account. Confirm the connected sender afterward.

The callback addresses must match exactly. Staff identity does not authorize recruiting services. [Google web-server OAuth](https://developers.google.com/identity/protocols/oauth2/web-server), [Google sign-in validation](https://developers.google.com/identity/openid-connect/openid-connect).

## 5. Calendar, Drive, and background tasks

The current approved temporary calendar is sales, Monday–Friday, 10:00–16:00 `America/Bogota`, with 30-minute interviews. For a new environment, create or choose a recruiting calendar. The recruiting Google account must be able to create and modify its events. Copy **Calendar settings → Integrate calendar → Calendar ID** into the hub. Save the actual time zone, weekdays, hours, and interview duration; confirm these instead of accepting an assumed schedule.

Create a private recruiting Drive root folder and give the recruiting account access to create folders and files inside it. Paste its folder ID into the hub. Public `anyone`-shared roots are rejected. Candidate data and original files remain private on Railway; Drive receives a secondary archive organized as Recruiting → Job → Location → Posting → Applicant, with separate application identity. Legacy folder labels remain preserved.

The Node service runs the queue without Apps Script. **Delivery activity** shows task outcomes, failed/uncertain deliveries, and worker health. Google outages leave accepted applications in the database. Fix the connection and retry failed tasks through the hub. Uncertain Gmail sends are searched by their exact message identity and are never automatically resent. Review the recorded outcome before authorizing any new message.

Do not install the old Sites Apps Script scheduler for this edition. Keep **automatic rejection and interview reminders disabled** until their specific tests and requirements are approved.

## 6. Post a job and rehearse the complete flow

Use a clearly labeled test posting and an inbox you control. Never send test invitations, rejections or offers to real applicants. On production, save private drafts while reviewing setup; changing `APPLICATIONS_ENABLED` affects all postings.

1. Open **Jobs → Create job**. Choose blank, duplicate, saved template or hiring request; follow **Details → Application → Scorecard → Review**. Set Remote/Hybrid/On-site and country/city, choose Required/Optional questions and an approved reusable scorecard. Save a draft, reopen and confirm persistence. Duplicate creates a new posting; the original retains its applicants.
2. Approve the description/questions and publish the test posting only for the controlled rehearsal. In a fresh environment, enable `APPLICATIONS_ENABLED=true` and redeploy first. Confirm public visibility in a signed-out browser.
3. Submit on desktop/mobile with a sample resume. Verify the accepted receipt, one application despite retries, correct answers/source/private original, and anonymous access denial.
4. Confirm actual SendGrid automatic email delivery, recruiter Gmail conversations and the shared Drive copy. Add a human review and reopen it; verify the reviewer, criterion evidence, grade and pinned rubric version. Check qualification evidence separately.
5. Explicitly start an assessment and submit through its emailed link. Explicitly invite to an interview; verify timezone/availability/conflicts, Calendar event/Meet, rescheduling, cancellation and matching history. Test manual rejection against the controlled inbox and verify one email per decision.
6. Rehearse Offer with approved test content and verify its hiring history and archived record. Completing earlier booking checks does not certify this full apply → review → assessment → schedule → offer path.
7. Close the synthetic posting afterward; retain evidence deliberately. Verify persistence after restart/redeploy with the same volume, queue recovery and an isolated restore as described below. If submission integrity fails, pause intake without deleting accepted records.

Local checks establish code behavior; actual consent, provider delivery/quotas, identities, hosted storage and DNS need dated live evidence. The launch checklist already records completed hosted component checks so they need not be confused with entirely missing setup.

## 7. How grading works

Qualification rules use the answers to your approved job-specific questions. They label which configured requirements pass or fail and show the reason. Automatic rejection starts disabled. No AI decides who is hired or who receives an interview.

Managers record a 1–5 scorecard with supporting notes. The dashboard uses each reviewer’s **latest** score and displays the average out of 5 with its reviewer count. For example, scores 4 and 5 produce **4.5/5**. The underlying data also provides an equivalent **90/100**, calculated by multiplying that average by 20. Revising your own score replaces your previous contribution instead of counting another vote. An applicant without a scorecard remains unreviewed; a high score helps prioritize human review and does not send an invitation automatically.

Approve a shared rubric before comparing applicants: job-relevant evidence, example work, assessment quality, and role-specific skills. Enter mandatory criteria as qualification rules and use consistent scorecard anchors. This version has no opaque AI ranking and does not invent requirements.

## 8. Backups, recovery, and the public domain

The current deployment has daily/weekly Railway volume snapshots configured; an isolated restore remains a separate unfinished acceptance test. For a new installation, enable backups and choose a retention schedule. Test recovery into a separate staging service without overwriting production. The database, original-file directory, and encryption key all matter; Drive archives do not replace the authoritative database. Use the included SQLite backup command for an online-consistent database snapshot; do not copy just `hiring.sqlite` while WAL writes are active. Treat every backup as private candidate data.

From a Railway shell inside the running container, create a new dated snapshot without overwriting an existing file:

```sh
DATA_DIR=/data node scripts/railway-backup.mjs /data/backups/hiring-YYYY-MM-DD.sqlite
```

Replace the date placeholder. This captures SQLite including committed WAL data; `/data/objects` still needs the volume backup. A snapshot stored on the same volume alone does not protect against losing that volume. Use Railway backups and store an encrypted recovery copy in a separate private location. Restore tests must include files and the separately held encryption key.

Keep this service on one replica. For larger multi-instance operation, plan a separate migration to a shared database/object store instead of mounting SQLite on multiple services.

The current **`jobs.aicaseleads.com`** cutover is already verified. The following procedure is for a future origin change or a new installation: after the controlled test and review gate pass, add the intended hostname to Railway’s custom domains. Use the exact DNS record Railway supplies. Remove/replace the old Sites routing for this hostname only after confirming the cutover; do not reuse the Sites CNAME or guess Railway’s target. Update `PUBLIC_SITE_ORIGIN=https://jobs.aicaseleads.com`, add both custom-domain callback URIs to the same Google client, and redeploy. Revalidate staff login, applicant links, email, Calendar, Drive, and HTTPS on the final hostname. If the Google client or sender changes, reconnect the recruiting grant.

Keep the Railway-domain callbacks during rollback preparation. If a release fails, redeploy the previous code against the same volume only when its migrations are compatible, or restore a tested private backup into staging first. Never attach two live instances to the same SQLite volume.

[Railway public networking and domain setup](https://docs.railway.com/networking/public-networking), [Railway backups](https://docs.railway.com/volumes/backups).
