# Railway edition verification

Local verification on 2026-10-09, Node 24.16.0. These checks used private temporary databases, synthetic applicants and credentials, and isolated integrations. They did not deploy Railway, alter the existing Sites installation, contact real Google services, or send recruiting messages.

## Completed checks

| Check | Evidence |
| --- | --- |
| Clean dependency installation | Fresh independent `npm ci --include=dev --include=optional --no-audit --no-fund` succeeded, installing 697 packages. Existing malformed optional SWC lock entries were repaired without changing previously pinned package versions. |
| Standalone build | `npm run build:railway` succeeded; emits the Node server, browser assets, and separate background module. Sites/mock authentication plugins are absent from this build graph. |
| Type and lint checks | `npm run typecheck`, `npm run lint`, and `git diff --check` passed. |
| Application regression suite | `npm test`: 217 passed, zero failed or skipped. Includes 10 signed Google staff-auth fixtures, hiring rules, grades, concurrency, provider recovery, and existing adapter regressions. Provider fixtures establish code behavior, not actual Google behavior. |
| Native Railway suite | `npm run test:railway`: 16 passed, zero failed or skipped. Actual SQLite transactions, migration drift/rollback, original-file persistence/privacy, 100 duplicate acceptance attempts, WAL-consistent backup, HTTP limits, task draining, health, and one-instance IaC. |
| Built production process | The native suite starts the actual Node entry point with `NODE_ENV=production`, a configured HTTPS origin, and a temporary mounted-data directory. Checks real assets, anonymous/forged-header denial, canonical OAuth redirects and Secure cookies, clean shutdown, and state surviving process restart. No real Google consent is followed. |

`npm run test:railway:http` passed with all 20 browser checks (zero skips), two unmocked desktop/mobile applications, and 3,000 synthetic HTTP applications in batches of 100. Each browser upload preserved its exact 860,603-byte PDF. Twenty concurrent duplicate POSTs created one application and exactly two initial tasks. A scorecard was entered through the real browser action panel. After restart with intake paused, all 3,003 applications remained, along with the private original and 4/5 manager grade (API equivalent 80/100). Both old and newly issued receipt links returned accepted status while intake was paused. The final complete harness took 24.7 seconds; local application POST p95 was 157 ms. These timings are local evidence, not a Railway performance promise.

## Browser and HTTP rehearsal

Run `npm run build:railway` followed by `npm run test:railway:http`. A Chromium browser is required; the harness uses local Chrome when available, otherwise Playwright Chromium.

The harness uses the built server and actual SQLite/filesystem adapters. It seeds a synthetic owner's hashed session **only in its private temporary database**; there is no test login endpoint or application authentication bypass. It uses `NODE_ENV=development` solely to permit localhost HTTP and development cookie names. The separate native test above checks production configuration and HTTPS cookie behavior.

The 20 existing browser checks combine real public navigation/privacy and asset checks with isolated API fixtures for recovery scenarios. Separate unmocked browser steps create an open role from the hiring dashboard, submit desktop and mobile applications with structurally valid PDFs over 512 KiB, fetch the exact original bytes as staff, deny anonymous download, and verify a manager grade and Railway setup instructions.

The capacity phase sends 3,000 application POSTs through the real Node HTTP boundary in 30 batches of 100 concurrent requests, with distinct synthetic applicant sessions and client addresses. It also checks 20 concurrent retries of one submission. Replays can issue different private confirmation tokens; all tokens must resolve to the same application and exactly one initial pair of email/archive tasks. Restart with intake paused must retain applications, files, and grades and permit recovery of an already accepted submission.

This workload does not establish provider quotas, Railway performance, or memory requirements for 100 simultaneous maximum-size file uploads. Size the actual service and verify its resource use during the hosted rehearsal.

## Review and live gates

[Independent authentication/runtime review](RAILWAY-INDEPENDENT-REVIEW.md) and [independent storage review](RAILWAY-STORAGE-REVIEW.md) found no reproduced blocker in their stated scopes. RuFlo review execution failed because its configured model route was invalid; local Claude workers were not logged in. The completed review was performed by independent Codex agents with tests, not Claude.

Docker and Railway CLI execution were unavailable on this machine. The Dockerfile was inspected and its npm/build/runtime steps were exercised locally, but an actual Linux image build and Railway deployment remain unverified.

Before opening intake, follow [the owner setup and rehearsal](RAILWAY-SETUP.md): real staff and recruiting Google authorization; Gmail delivery/reply recovery; Calendar/Meet availability, booking, rescheduling and cancellation; private Drive archival; actual Railway volume restart/redeploy persistence; separate restore of database, originals and token key; and final custom-domain DNS/HTTPS. A green health endpoint does not establish a connected recruiting account or successful delivery.

The existing Sites deployment is unchanged. The Railway edition starts empty, with intake paused; create the two draft roles explicitly. Keep automatic rejection and reminders off until their approved rules and live tests pass.
