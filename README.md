# AI Case Leads careers and hiring hub — Railway edition

A custom careers website at **https://jobs.aicaseleads.com** and private hiring dashboard at **[/team](https://jobs.aicaseleads.com/team)**. This edition runs on **Node 24** with an authoritative SQLite database and private original uploads on one Railway `/data` volume. Google Workspace provides staff login, recruiter conversations, Calendar/Meet and a secondary shared Drive archive. SendGrid sends automatic emails independently of recruiter Gmail. A built-in processor handles queued integration tasks. No ATS subscription is required.

**Using the live app? Start with [Hiring quick start](docs/HIRING-QUICK-START.md).** Owner login and the currently connected recruiting sender are both `sales@aicaseleads.com`. The sales calendar is temporary; changing to Mariam's mailbox requires her authorization. Staff sign-in and recruiting authorization are separate Google flows.

**Operating or installing it? Read [Railway setup](docs/RAILWAY-SETUP.md).** The existing Railway deployment, Google grant, domain/HTTPS and controlled application/Drive/calendar checks have dated evidence. [Launch checklist](docs/LAUNCH-CHECKLIST.md) distinguishes those completed checks from remaining privacy/retention approval, isolated backup restoration, separate staff-identity testing and the complete offer rehearsal. A fresh installation starts empty with intake paused; it does not copy the old Sites database automatically.

## Deploy

Use the root `Dockerfile`. Attach a persistent volume at `/data`, configure server variables using [`.env.railway.example`](.env.railway.example) and the setup guide, use one always-running instance, and configure `/api/health` as the deployment healthcheck. The current deployment uses `PUBLIC_SITE_ORIGIN=https://jobs.aicaseleads.com` and `EXPECTED_RECRUITING_EMAIL=sales@aicaseleads.com`. Fresh environments should keep `APPLICATIONS_ENABLED=false` until their own controlled tests pass. Optional Railway IaC is in [`.railway/README.md`](.railway/README.md).

```sh
npm ci
npm run build:railway
npm run start:railway
```

Startup applies append-only SQL migrations after storage is mounted. Never use an ephemeral filesystem for production. Keep credentials in Railway Variables and back up the encryption key separately and securely. The service does not trust browser-supplied staff identity headers. Do not reset the existing production installation while following fresh-install instructions.

## Hiring workflow

In **Jobs → Create job**, start blank, duplicate a posting, use a saved template or turn a hiring request into a draft. Follow **Details → Application → Scorecard → Review**. Drafts stay private; closed postings preserve their applicants and files. Applicants need no account. Recruiters explicitly initiate assessments and interview invitations; moving stages alone sends no invitation.

Qualification rules and human scorecards are separate. Reusable scorecards compute a weighted criterion average; the displayed overall grade averages each reviewer's latest review, with an equivalent 0–100 value available in the API. Ungraded applicants have no grade. Compare within the same posting and approved rubric. PDF text reading and English/Spanish OCR run locally; optional OpenRouter/OpenAI evidence summaries require an explicitly authorized reviewer action and do not rank, grade or reject applicants.

## Verification

```sh
npm run typecheck
npm run lint
npm test
npm run test:railway
npm run build:railway
npm run test:railway:http
```

[Railway verification](docs/RAILWAY-VERIFICATION.md) records dated hosted checks, historical local evidence and remaining gaps. [Guided hiring audit](docs/HIRING-UX-AUDIT.md) documents the redesign's test scope. Existing Sites/legacy adapter tests remain regression fixtures and do not establish Railway or Google live behavior.

For retained Sites development, `dev`, `build` and `start` use the original Workers build. Railway commands use a separate Node build and independent staff identity. Sites D1/R2 bindings and the legacy Apps Script scheduler are not needed for the current Railway deployment.
