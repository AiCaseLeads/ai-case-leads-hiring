# Live intake audit — 15 October 2026

## Verified

- Railway release `9676178` reached SUCCESS. Public health returned ready with storage and background enabled.
- Live job-card ZIP download contained 66 applications and 66 uploaded files; manifest reported zero missing files and ZIP CRC validation passed. Counts are a point-in-time snapshot while intake continues.
- Per-job download-all CSV/ZIP controls and page/all-matching download selection are visible in production. Selecting all matching applications does not enable mass hiring decisions.
- Completed Drive archive tasks were visible in the delivery ledger. This confirms observed archive activity, not a full backup/restore audit.
- Missing recruiter Gmail authorization now displays Setup required, explains the next action, and holds delivery without spending automatic retry attempts. Connecting Gmail does not automatically release held messages.
- Application storage and download do not depend on recruiter Gmail being connected.

## Outstanding

- Maria must personally authorize her recruiting Gmail in Settings. Candidate email delivery cannot be verified until that connection and the intended sender configuration are complete. No real applicant messages were retried during this audit.
- OpenRouter is configured, but live AI reviews had validation/incomplete-response failures. Provider schema constraints and safe diagnostic error codes were improved; successful live ranking remains unverified. Use original applications for human review while resolving this.
- Full production database integrity/restore checks were not performed: Railway SSH was unavailable. Local isolated tests do not substitute for a production restore exercise.
- Real Gmail sender/reply headers and reply routing remain pending; existing owner Drive/calendar connection was preserved.

## Test evidence

- Backend suite: 378 passed, three existing OCR skips, zero failures before the final diagnostic-only additions.
- Railway suite: 19 passed. Focused AI diagnostic and UI tests subsequently passed.
- Isolated load verification: 3,000 synthetic applications with a 100-concurrent submission burst; repeated identical submission keys produced one record. External integrations were mocked.
- Independent native-agent review performed. The Claude swarm worker returned no usable review output; no Claude review is claimed.

No live applicant decisions were changed or new test applications inserted during this audit.
