# Railway verification and remaining acceptance checks

## Current deployment evidence — reconciled 2026-10-12

Production is https://jobs.aicaseleads.com, with staff at `/team`. Railway runs Node 24 in the actual Docker image, one always-running replica, the `/data` volume, SQLite/private originals and the built-in worker. The current connected recruiting account is `sales@aicaseleads.com`; the earlier Mariam sender plan has been superseded.

Fresh read-only verification on 2026-10-12 confirmed Railway deployment `ac2f616b-5325-4d38-9350-065db6e916bc` (`8f6096c76c97780f601c9bc83bb6bddfb8ac74a1`) is SUCCESS. The domain is active with valid TLS and `jobs` CNAME `5j9uygci.up.railway.app`. Public Engineer and Creative Strategist jobs are open and submission-enabled. Daily snapshots retain 6 days, weekly snapshots 27 days; actual October 11/12 daily and October 11 manual snapshots exist. None of those observations proves an isolated restore.

Dated hosted verification on 2026-10-10 established:

| Hosted check | Evidence and boundary |
| --- | --- |
| Actual owner and recruiting Google authorization | Sales signed in through Google and granted Gmail/Calendar/Drive access. A separate real manager/recruiter login is still unverified. |
| Application and actual provider delivery | A clearly labeled synthetic application returned an accepted receipt and saved its matching record/original PDF. Gmail delivery and shared Drive archival completed; archived PDF bytes matched the original. This does not prove every email type or future provider quota. |
| Actual Calendar/Meet | Temporary sales calendar/Bogotá hours were saved; controlled availability, booking, Meet, rescheduling and cancellation completed, with matching archive tasks. Full assessment/offer rehearsal remains separate. |
| Volume persistence | Synthetic applicant, private original, Drive link, Interview stage and pinned 4/5 scorecard survived real redeployment. Restart/redeploy persistence is different from backup restoration. |
| Final domain | Public health/job pages returned 200 at `jobs.aicaseleads.com`; owner access and Google callback cutover worked on the final hostname. |
| Guided admin and private drafts | Four job starts were visible. A synthetic On-site/Madrid/Spain draft saved, reopened and closed; public API stayed 404. Existing open jobs were preserved. |
| Actual deployed Linux OCR | Native Poppler/Tesseract read scanned and mixed synthetic PDFs, both ready with one OCR page and no incomplete flag. Temporary files/access were removed afterward. |
| Privacy boundary | Anonymous applications, originals, job-setup and résumé-reading endpoints returned 403. This is access testing, not approval of the applicant privacy/retention policy. |

The hosted evidence was recorded in the workspace deployment verification ledger and `outputs/hiring-redesign-live-verification.md`. It is dated operational evidence, not a claim that every open launch item has passed.

The latest redesign's isolated checks passed: **279 backend/native OCR tests, 25 component browser tests, 19 Railway runtime tests, 20 production-browser checks**, typecheck, lint and build. The real HTTP rehearsal exercised four job starting points, desktop/mobile PDFs, 3,000 synthetic load applications (1,000 full PDF journeys at concurrency 100 plus another 1,000 simultaneous-submission phase), duplicate recovery and restart preservation. Integrations were isolated; this is not hosted capacity or Google quota certification. See [the complete redesign audit](HIRING-UX-AUDIT.md).

## Historical baseline — local checks on 2026-10-09

The following baseline is preserved for its test scope, not presented as the current deployment status. Local verification used Node 24.16.0. These checks used private temporary databases, synthetic applicants and credentials, and isolated integrations. They did not deploy Railway, alter the existing Sites installation, contact real Google services, or send recruiting messages.

### Baseline completed checks

| Check | Evidence |
| --- | --- |
| Clean dependency installation | Fresh independent `npm ci --include=dev --include=optional --no-audit --no-fund` succeeded, installing 697 packages. Existing malformed optional SWC lock entries were repaired without changing previously pinned package versions. |
| Standalone build | `npm run build:railway` succeeded; emits the Node server, browser assets, and separate background module. Sites/mock authentication plugins are absent from this build graph. |
| Type and lint checks | `npm run typecheck`, `npm run lint`, and `git diff --check` passed. |
| Application regression suite | `npm test`: 217 passed, zero failed or skipped. Includes 10 signed Google staff-auth fixtures, hiring rules, grades, concurrency, provider recovery, and existing adapter regressions. Provider fixtures establish code behavior, not actual Google behavior. |
| Native Railway suite | `npm run test:railway`: 16 passed, zero failed or skipped. Actual SQLite transactions, migration drift/rollback, original-file persistence/privacy, 100 duplicate acceptance attempts, WAL-consistent backup, HTTP limits, task draining, health, and one-instance IaC. |
| Built production process | The native suite starts the actual Node entry point with `NODE_ENV=production`, a configured HTTPS origin, and a temporary mounted-data directory. Checks real assets, anonymous/forged-header denial, canonical OAuth redirects and Secure cookies, clean shutdown, and state surviving process restart. No real Google consent is followed. |

`npm run test:railway:http` passed with all 20 browser checks (zero skips), two unmocked desktop/mobile applications, and 3,000 synthetic HTTP applications in batches of 100. Each browser upload preserved its exact 860,603-byte PDF. Twenty concurrent duplicate POSTs created one application and exactly two initial tasks. A scorecard was entered through the real browser action panel. After restart with intake paused, all 3,003 applications remained, along with the private original and 4/5 manager grade (API equivalent 80/100). Both old and newly issued receipt links returned accepted status while intake was paused. The final complete harness took 24.7 seconds; local application POST p95 was 157 ms. These timings are local evidence, not a Railway performance promise.

### Baseline browser and HTTP rehearsal

Run `npm run build:railway` followed by `npm run test:railway:http`. A Chromium browser is required; the harness uses local Chrome when available, otherwise Playwright Chromium.

The harness uses the built server and actual SQLite/filesystem adapters. It seeds a synthetic owner's hashed session **only in its private temporary database**; there is no test login endpoint or application authentication bypass. It uses `NODE_ENV=development` solely to permit localhost HTTP and development cookie names. The separate native test above checks production configuration and HTTPS cookie behavior.

The 20 existing browser checks combine real public navigation/privacy and asset checks with isolated API fixtures for recovery scenarios. Separate unmocked browser steps create an open role from the hiring dashboard, submit desktop and mobile applications with structurally valid PDFs over 512 KiB, fetch the exact original bytes as staff, deny anonymous download, and verify a manager grade and Railway setup instructions.

The capacity phase sends 3,000 application POSTs through the real Node HTTP boundary in 30 batches of 100 concurrent requests, with distinct synthetic applicant sessions and client addresses. It also checks 20 concurrent retries of one submission. Replays can issue different private confirmation tokens; all tokens must resolve to the same application and exactly one initial pair of email/archive tasks. Restart with intake paused must retain applications, files, and grades and permit recovery of an already accepted submission.

This workload does not establish provider quotas, Railway performance, or memory requirements for 100 simultaneous maximum-size file uploads. Size the actual service and verify its resource use during the hosted rehearsal.

## Review and outstanding acceptance checks

[Independent authentication/runtime review](RAILWAY-INDEPENDENT-REVIEW.md), [independent storage review](RAILWAY-STORAGE-REVIEW.md), and independent Codex redesign review completed in their stated scopes. Blocking reproduced findings were resolved. RuFlo review execution failed on an invalid model route; local Claude workers lacked authentication. Those attempts are not counted as successful reviews.

The 2026-10-09 baseline originally could not build Docker or deploy Railway. Subsequent real Railway Docker deployments and deployed Linux OCR checks resolve that old environment limitation; it is no longer an open deployment gate.

Remaining acceptance work is explicit in [LAUNCH-CHECKLIST.md](LAUNCH-CHECKLIST.md):

- Isolated backup restoration of the database, originals and separately held encryption key.
- Owner approval of privacy/retention wording and the operational deletion process.
- A complete controlled apply → human review → assessment → schedule → offer rehearsal, including one-email-per-rejection and real known-thread reply/recovery checks.
- Separate actual manager/recruiter/unauthorized staff identity tests; owner access and fixture role tests are already established.
- The first genuine overdue-review email; actual timed interview reminder delivery before enabling that option.
- Provider interruption/recovery and observed hosted resources/quotas during a controlled rehearsal.

The service is already deployed and intake-enabled for the two existing public roles; describing it as an empty private Sites instance with no Google grant is obsolete. A **fresh installation** still starts empty/paused and requires its own authorization and tests. Keep new automatic rejection rules and untested timed interview reminders off until explicitly approved and verified. LinkedIn/Indeed hiring is independent of the portal's remaining acceptance work.
