# Guided hiring redesign audit — 2026-10-10

This audit replaces the previous long job form and confusing batch terminology. The existing application records, original files, archive identity and human grading are preserved.

## Implemented

- Four starting points: blank job, duplicate posting, saved job template and internal hiring request. All lead to Details → Application → Scorecard → Review. Drafts remain private; publishing requires explicit preview approval.
- Remote, hybrid and on-site work arrangements with country selection and a required workplace city where appropriate. Legacy locations remain unchanged until deliberately edited.
- Required/Optional question controls, a question library, reusable criteria with a ready 1–5 scale, and optional advanced settings.
- Previous postings retain their applicants and files. New postings receive separate archive identity automatically. Copies preserve custom recruiting project groups; partial edits preserve existing archive fields.
- Home centers on recruiting tasks with compact connection status. Settings guides Google/calendar/Drive setup. Applicant profiles separate application/files, review/scorecard, and activity/messages.
- Local English/Spanish OCR reads scanned and mixed PDFs without another API key. Private originals remain unchanged. Extraction has explicit page, text, process, memory and deadline limits and never blocks intake.
- Atomic job/template/request/scorecard saves, explicit version conflicts and idempotent job-save retries. A stale wizard cannot silently overwrite a concurrent scorecard assignment. Pending template saves lock competing job actions.

## Verification

| Check | Result |
| --- | --- |
| Backend, integration and real native OCR suite | 279 passed, zero failed/skipped. Includes scanned and mixed documents, the OCR page cap, process deadline/cleanup and archive retention on partial job edits. |
| Component browser flows | 25 passed, zero failed/skipped, including a deferred template-save regression proving competing actions remain locked. Includes guided setup, scorecard version conflicts, keyboard tabs, unsaved drafts and reminder filters. |
| Native Railway adapter/runtime suite | 19 passed, zero failed/skipped. |
| TypeScript, lint and Railway build | Passed. |
| Built HTTP/browser rehearsal | All four starting points exercised through the actual app server. Three resulting drafts stayed private. Desktop and mobile applicants submitted private PDFs; originals matched exactly and anonymous access was denied. Human grades and pinned scorecard versions persisted. |
| Intake/storage load and restart | 3,000 synthetic load applications; 1,000 full PDF journeys at concurrency 100, including 1,002 private PDFs with browser submissions. Another phase sent 1,000 simultaneous application requests. Twenty duplicate retries produced one application. Restart retained 3,003 total applications and original files. |

The full HTTP rehearsal took 42 seconds on local disk. PDF journey p95 was 868 ms; application POST p95 across the workload was 4,037 ms. These are isolated local measurements, not a Railway throughput or Google delivery guarantee. Google/AI were disconnected in the load test. No real applicant was scored, rejected or sent a test message.

Independent Codex reviews found and resolved stale scorecard binding/version display, rejection approval, template acknowledgment/action race and archive-field retention issues. Local Claude workers were not authenticated; RuFlo review execution failed on its configured model route. Neither is counted as a successful review.

Hosted checks are recorded separately after deployment. Backup snapshots are configured, but an isolated restore remains pending. The first genuine overdue-review email also remains a live verification item. OCR may require manual correction, and provider quotas can delay background email/Drive delivery.

See [the hiring quick start](HIRING-QUICK-START.md) and [PDF/OCR limits](PDF-READING.md).
