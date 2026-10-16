# Railway launch checklist

Reconciled 2026-10-12. Production is https://jobs.aicaseleads.com; the private dashboard is `/team`. The live system uses Node 24 on Railway, an authoritative SQLite database and private originals on the `/data` volume, and an in-process integration worker. The existing company Google connection retains the temporary calendar and shared Drive archive. Recruiting Gmail now uses separate recruiter-owned grants; sales is blocked from applicant-mail transport. Maria’s live consent and controlled mail delivery remain pending. There is no Sites/D1/R2 or Apps Script setup requirement for this deployment.

Checked items below reflect dated evidence, principally the hosted checks on 2026-10-10 and the deployment/Google verification ledger. Fresh 2026-10-12 checks additionally confirmed the successful Railway deployment, active domain/TLS, both public jobs accepting submissions, and existing backup snapshots. They do not certify that every integration will remain healthy. Open items are separate from features already implemented. See [Railway verification](RAILWAY-VERIFICATION.md), [the setup guide](RAILWAY-SETUP.md), and [the hiring quick start](HIRING-QUICK-START.md).

## Deployment, access and domain

- [x] Actual Railway Docker deployment succeeded. Hosted redesign deployment `ac2f616b-5325-4d38-9350-065db6e916bc` used GitHub commit `8f6096c76c97780f601c9bc83bb6bddfb8ac74a1`; `/api/health` and both existing public jobs returned 200.
- [x] One persistent `/data` volume holds SQLite and private original files. The synthetic application, original PDF, Drive link and saved grade survived redeployment. Local native tests also cover restart persistence and WAL-consistent backup.
- [x] `jobs.aicaseleads.com` was cut over to Railway with HTTPS and matching Google callbacks. Staff access and applicant pages were verified at the final origin; old Railway-host links use the canonical origin.
- [x] Owner `sales@aicaseleads.com` signed in through actual Google OAuth. Anonymous requests to applications, originals, job setup and résumé-reading APIs were denied. Local tests cover unauthorized and forged identities.
- [ ] Verify a separate real manager/admin, a recruiter, and an unauthorized signed-in account. Only an actual owner login has been established in the live evidence; fixture permissions are not a substitute.
- [x] Railway daily (6-day retention) and weekly (27-day retention) volume snapshots were configured. Fresh 2026-10-12 checks confirmed actual October 11/12 daily snapshots and an October 11 manual snapshot.
- [ ] Restore a backup into an isolated recovery environment, including SQLite, private originals and the separately held encryption key. Snapshot existence and restart persistence do not prove restore readiness.

## Job setup and applicant consent

- [x] Guided blank/duplicate/template/hiring-request starts passed local app-server tests. A hosted synthetic private draft saved, reopened with On-site/Madrid/Spain intact, then closed; it stayed inaccessible on the public job API.
- [x] Required/Optional questions, private drafts, posting history and pinned reusable scorecards are implemented. Qualification and human grades remain separate; new postings keep automatic rejection disabled.
- [ ] Owner/hiring managers approve each real role's description, location, questions, assessment and scorecard criteria. Existing public Engineer/Creative Strategist pages do not establish approval of every hiring requirement.
- [ ] Approve applicant privacy/contact wording and the retention period/process, including deletion across Railway, backups and Drive. Publishing a notice does not establish owner approval or an implemented retention policy.
- [ ] Before activating any automatic rejection rule, approve its requirements and prove known failures reject once while missing information stays in review. Keep the feature off until this passes.

## Actual Google behavior

- [x] Recruiting `sales@aicaseleads.com` granted Gmail, Calendar and Drive access through Google consent. Staff login and recruiting authorization are separate grants.
- [x] A controlled live application produced a confirmation, matching dashboard record, actual Gmail task delivery, private original PDF and shared Drive copy. The archived PDF bytes matched the original.
- [x] The sales calendar's approved temporary schedule is Monday–Friday, 10:00–16:00 `America/Bogota`, 30-minute interviews. Actual availability, booking, Meet link, rescheduling and cancellation were verified; cancellation and follow-up Drive tasks completed.
- [x] Shared Drive archival retained application identity and history. The deployed worker completed synthetic Gmail/Calendar/Drive tasks without Apps Script.
- [ ] Verify actual known-thread inbound replies and uncertain-send reconciliation through Gmail, not only provider fixtures or a completed initial email task.
- [ ] Rehearse a controlled provider outage/revoked grant and recovery. Accepted applications must stay intact; retry only safe failures and reconcile uncertain Calendar/Gmail work without duplication.
- [ ] If enabling interview reminders, prove actual 24-hour/1-hour delivery once, with the correct timezone/Meet link, and suppression for pending/cancelled/replaced/past bookings. Default-off code behavior has isolated coverage; timed live delivery is separate.
- [ ] Observe the first genuine overdue-review digest reaching the authorized staff recipient once after the saved 48-hour threshold. Recipient/day deduplication and revalidation passed isolated tests; zero overdue records did not exercise live delivery.
- [ ] Recruiter onboarding release: invite Mariam as Head recruiter, verify her own sign-in and personal calendar consent, save her availability, and verify a booking/reschedule/cancellation on her calendar. Personal Gmail and calendar setup do not replace the company Drive grant or change its expected account. Existing invitations retain their calendar identity. Her consent and real delivery must be confirmed separately from isolated tests.

## Controlled end-to-end rehearsal

- [x] Desktop/mobile application, upload identity/privacy, required fields, expired/failed uploads, closed jobs, stale forms, duplicate clicks and uncertain-response recovery passed isolated app-server/browser tests.
- [x] Live synthetic apply → receipt → dashboard → Gmail → Drive passed. Original PDF reading/OCR and a reusable 4/5 human scorecard were verified on Railway and preserved with the assigned scorecard version. No real applicant was graded or sent a test message.
- [x] Live controlled interview booking → reschedule → cancel passed. This is a component rehearsal, not a completed hire.
- [ ] Complete one controlled apply → human review → assessment → schedule → offer rehearsal with a test inbox and approved offer content. Verify assessment submissions, matching history and Drive updates; do not send test offers to real applicants.
- [ ] Test a manual rejection against the controlled inbox and verify exactly one email per decision. Separately verify link expiry/revocation, conflicts, attendance and authorized access through the complete rehearsal.

## Release evidence and ongoing checks

- [x] Browser Back/Forward regression fixed and verified on the built app, including applicant origin/filters/page, job setup history, pending-save isolation and invalid-step recovery. The 2026-10-12 integrated interface suite passed 38 tests; the full application/load/restart rehearsal passed again. See the navigation section in [Railway verification](RAILWAY-VERIFICATION.md).
- [x] Latest redesign checks: 279 backend/native OCR tests, 25 component browser tests, 19 Railway runtime tests, 20 production-browser recovery checks, TypeScript, lint and built HTTP rehearsal passed.
- [x] Isolated intake/storage load: 3,000 synthetic applications, including 1,000 full PDF journeys at concurrency 100, another 1,000 simultaneous-submission phase, duplicate retries and restart preservation. Google/AI integrations were isolated; this does not establish hosted resource capacity or provider quotas.
- [x] Actual deployed Linux OCR read scanned and mixed synthetic PDFs. Private originals were unchanged; manual fallback and extraction limits remain relevant.
- [x] Independent Codex review completed and blocking findings were resolved. Claude workers lacked authentication; RuFlo execution failed on its configured model route. Neither is counted as a successful review.
- [ ] During the next hosted controlled rehearsal, observe memory/disk, queue delay and Gmail/Calendar/Drive quotas. Agree who monitors failures, restores backups and handles retention requests.

## Rollback and incident handling

If submission integrity is uncertain, set `APPLICATIONS_ENABLED=false` and close affected postings. Preserve accepted applications, original files, receipts, history and queued tasks; do not reset the production database or send compensating rejections. Google outages are integration-task recovery problems; SQLite remains authoritative. A public portal is already deployed, while LinkedIn/Indeed hiring can continue independently. Remaining checklist items must be tracked explicitly rather than represented as completed.

## Recruiter-owned Gmail cutover

- [ ] Verify SendGrid authenticated notify domain, server key and signed delivery callback; receive a controlled no-reply message and confirm Null MX rejects inbound replies. Maria’s Gmail is separate for her conversations.
- [ ] Verify automatic mail uses SendGrid with no recruiter identity in received headers or body; no inbox or Google alias is required.
- [ ] Verify a recruiter conversation sends from the acting recruiter and receives replies in that recruiter’s Gmail; separately verify any supported dashboard reply synchronization.
- [ ] Confirm existing Drive archival and Calendar behavior still work after the mail cutover.
