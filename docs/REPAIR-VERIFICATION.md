# October 9 hiring-hub repair verification

This release implements the custom hiring hub with Google Workspace integrations. No Ashby, Trigger.dev or AI-review account is needed for the active custom flows. The legacy adapter tests remain in the complete suite and are not evidence of a connected provider.

## Software changes

- Settings and decisions now reject stale writes; administrative access changes have audit records. Bulk operations check every displayed revision before any queued effects.
- Expired candidate invitations can be renewed while preserving assessment/interview and provider identities. Old links stop working, booked links cover the interview period, and complete assessment/interview history remains available.
- Stored bookings remain visible during an availability outage. Failed Google booking work is shown as unconfirmed and permits cancellation. Booking times show their actual time zone.
- Calendar and Drive destination changes are guarded once work exists; pending Calendar operations use their original calendar ID.
- Archive snapshots include all assessments/interviews, answers, source and communication history. Original files load one at a time; durable checkpoints allow interrupted runs to resume without restarting every earlier file.
- Gmail imports bounded MIME bodies and private attachments, records incomplete/quarantined imports, retries failures and repairs partial imports. Mailbox delta pages, new-thread catch-up, leases and deleted-message observations avoid losing or starving replies. Exact manual-outbound reply parents remain associated with their original application.
- Manual email action IDs distinguish retries from intentional repeated messages. Uncertain delivery does not blindly resend or create repeated hiring revisions.
- Frozen application recovery works during paused intake and after a role closes. Confirmation still requires accepted server state.
- Document uploads require real bounded PDF/Word structure, with well-formed required OOXML parts. Per-file limits remain 10 MiB; an application's originals total at most25 MiB. These checks do not claim malware scanning.
- Expired unattached originals are reclaimed safely, with retry backoff that lets healthy work proceed. Accepted application files are excluded.
- Provider, reconciliation and storage operations share bounded execution budgets. Worker/scheduler status separates a wakeup from successful processing and exposes failures.
- Reports/list/export query narrower records. CSV export visibly caps at1,000 matching summaries. Reviewer rationale stays in candidate details, avoiding unnecessary large transfers.
- The selected sender is mariam@aicaseleads.com. OAuth state and stored grants are bound to the chosen client configuration; client changes invalidate old consent/grants. Tokens stay on the server.

## Applicant grading

Qualification rules evaluate explicit answers against approved requirements; they do not infer resume quality. Human reviewers enter an overall1–5 score with criteria and evidence. Each person's latest score counts once, weighted equally. Scores4 and5 yield4.5/5=90/100. Missing reviews remain ungraded. Same-role grade sorting, reviewer counts, qualification filters, duplicate flags and browser-local saved review queues are visible. Scores never automatically reject or hire.

## Verified evidence

- Complete automated suite:207 passing tests, including custom flows, isolated provider behavior and legacy regression coverage.
- TypeScript, full ESLint, migration consistency and Git diff checks passed.
- Production-built Worker public/browser suite:20 passing tests on desktop/mobile, including real paused-intake/auth navigation and isolated live-form fixtures; no skipped asset-cache check.
- Dashboard browser fixture:16 behavior groups,0 page errors and17 intercepted writes. Screenshots explicitly label synthetic data; this does not constitute real owner job posting or Google delivery.
- Capacity rehearsal:3,000 synthetic application records and100 concurrent HTTP submissions, plus100 concurrent replay attempts producing one application. This measures local SQL/HTTP behavior, not hosted D1 or Google throughput. A separate6,000 essay-bearing record regression checks bounded reports/overview data transfer. Archive tests cover101 originals, sequential loading and restart checkpoints.
- Swarm watchdog passed. Local Claude workers could not execute because they were unauthenticated; RuFlo's execution route returned an invalid configured model. Neither is reported as a completed review. Independent Codex source reviews plus tests and browser verification provide the executed review gate.

## Live gates still pending

The deployment preserves the current public careers-page hosting audience and protected staff dashboard. It retains paused intake, two draft real-role templates, and disabled automatic rejection. The owner has not yet posted their test job. Google is unconnected: actual Gmail delivery/replies, Calendar availability/Meet/rescheduling/cancellation, private Drive contents/ACLs and a genuine unattended Apps Script run require account setup and controlled verification. The branded domain is registered with the host but DNS/TLS is pending. Real staff permissions and final applicant privacy/retention content must be approved and exercised before public intake.

Follow OWNER-SETUP-AND-TEST.md. The software checks above do not override these remaining launch gates.
