# AI Case Leads careers and hiring hub — Railway edition

A custom careers website and private hiring dashboard for `jobs.aicaseleads.com`. This standalone edition runs on **Node 24**, with an authoritative SQLite database and private original uploads on one Railway volume. Google Workspace provides staff login, recruiting Gmail, Calendar/Meet, and a secondary Drive archive. A built-in processor handles queued integration tasks. No ATS subscription is required.

**Start here: [Railway setup and owner test](docs/RAILWAY-SETUP.md).** Owner login: `sales@aicaseleads.com`. Recruiting sender: `mariam@aicaseleads.com`, unless you explicitly change it. Staff sign-in and mailbox authorization are separate Google flows.

This edition does not change the existing Sites deployment. It starts with an empty database and paused intake. Create the two draft roles from the hub; automatic rejection and reminders start off. The current Sites database is not automatically copied. Real Google authorization, Railway deployment, volume restore/persistence, and final domain cutover remain launch checks.

## Deploy

Use the root `Dockerfile`. Attach a persistent volume at `/data`, configure the server variables from [`.env.railway.example`](.env.railway.example), use one always-running instance, and configure `/api/health` as the deployment healthcheck. Modern optional Railway IaC is in [`.railway/README.md`](.railway/README.md). No `railway.json` is used for new services.

```sh
npm ci
npm run build:railway
npm run start:railway
```

Startup applies append-only SQL migrations after storage is mounted. Never use an ephemeral filesystem for production. Keep credentials in Railway Variables and back up the encryption key securely. The service does not trust browser-supplied staff identity headers.

## Hiring workflow

Sign in at `/team`. Create the two draft roles, edit job descriptions/forms/requirements, and add approved managers and recruiters. Applications, evidence, notes, shared review, scorecards, bulk actions, assessments, interview booking, reports, communication history, task failures, and Drive links are custom features. Recruiters explicitly initiate assessments and interview invitations. Applicants need no account.

Qualification rules and manager scorecards are separate. Grades display the average of each reviewer’s latest 1–5 score; the API also provides its 0–100 equivalent. An unreviewed applicant has no grade. Compare candidates within one role. There is no AI ranking or AI rejection.

## Verification

```sh
npm run typecheck
npm run lint
npm test
npm run test:railway
npm run build:railway
npm run test:railway:http
```

[Railway verification](docs/RAILWAY-VERIFICATION.md) records actual checks and remaining live gates. Existing Sites/legacy adapter tests remain regression fixtures; they do not establish Railway or Google live behavior. Follow the owner rehearsal in the setup guide before opening intake or moving DNS.

For retained Sites development, the existing `dev`, `build`, and `start` commands use the original Workers build. Railway commands use a separate Node build and independent staff identity.
