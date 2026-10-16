# Readable application downloads and Drive archive

The hiring database remains the authoritative record. Applicant-facing upload
files and all private original uploads are retained without changes.

- A single application downloads as a readable PDF summary.
- A bulk download is a streaming ZIP. Each applicant has an independent folder
  containing `Application summary.pdf` and their original uploaded files.
- `Download report.pdf` records the count and any unavailable/mismatched original
  files. Missing originals never silently disappear from the report.
- No generated JSON or spreadsheet is included in a ZIP. The authenticated CSV
  API remains available for reporting and contains readable answers rather than
  raw JSON columns.

PDF summaries contain the recorded question labels and answers, screening result,
available AI findings and quotes, attachment names, assessments, interviews,
team reviews, messages, and hiring history. A current job description is clearly
labeled as current; it is not presented as a historical description snapshot.
Private file routes and assessment/interview capability URLs are not printed as
attachment or scheduling metadata.

## Drive

Existing Recruiting / Project / Location / Hiring round / Applicant identities
stay the same. New summaries use immutable `Application-rN.pdf` revision names.
PDF metadata and font subsets are deterministic, so retries do not create new
files or change bytes merely because the worker restarted.

During archival, historical `application-rN.json` files are converted only when
the filename, application folder, app-generated property hash, retained file ID,
checksum, application ID, job ID, and revision agree. Each historical PDF is
uploaded and verified first. Then the matching app-created JSON is moved to
Google Drive Trash, where it can be recovered under the account's retention
rules. There is no permanent deletion, and unrelated JSON files are untouched.
Original Drive IDs and checksums remain in the private `archive_items` table;
successful task results include the IDs moved during that attempt.

Conversion failure retains the JSON and leaves the task retryable. The worker
must only record `archiveFormat: pdf-v2` after conversion completes. The separate
backfill queue converts older completed archives without sending emails or
changing candidate decisions. Company Drive consent and a private root folder
remain required.

Archival checkpoints retain the current PDF, the original-file cursor, the
historical source being converted, and the verified PDF awaiting JSON retirement.
Each background invocation handles at most one historical revision and continues
as pending work after 30 seconds. Normal progress does not consume failure retries.
Unchanged provider failures, quota errors, and no-progress budget failures remain
visible with a safe phase/provider/status diagnostic and a bounded retry policy.
New applications and ordinary integrations take priority over legacy backfill.
`readable-v2` invalidates old renderer checkpoints without creating new current
PDF identities. A historical JSON that differs from the authoritative PDF of the
same revision is retained as `Application-rN-previous-record.pdf`, preserving both.

The licensed Noto Sans fonts are packaged with the Railway Docker image. Latin,
Greek and Cyrillic text render normally. Other unsupported characters are shown
as explicit Unicode code points, preserving the original value; original files
and stored answers are unchanged.

## Release verification — 2026-10-15

The final merged release passed 425 backend checks (three optional native OCR
checks skipped), 21 Railway runtime checks, typecheck, lint with no errors, and
the Railway build. Independent continuation tests cover slow provider responses,
more than eight restarted cycles, late JSON arrivals, retry accounting, private
file identity, and preservation of different historical/current PDFs.

The real built-server browser/HTTP rehearsal accepted 3,000 synthetic applications,
including 1,002 private PDFs and a burst of 1,000 simultaneous submissions. Twenty
duplicate requests produced one application; all 3,003 records survived restart.
Separate built-server checks verified application Trash/Restore, private original
bytes, readable PDF/ZIP downloads, and cancelled emails staying cancelled.
These isolated checks do not establish hosted throughput, live Google delivery,
or backup restoration. Live archive conversion is a separate deployment check;
old folders are converted asynchronously without replaying applicant emails.

Hosted verification passed on the fictional AI-match test application: its current
PDF and all five historical JSON revisions became readable PDFs in the existing
Drive folder, the original résumé remained, and the task completed with `pdf-v2`.
Only that synthetic task was temporarily prioritized to exercise every continuation
through the backlog; no real candidate decision or email was changed. The temporary
Railway SSH key used for the check was removed. Other old folders remain background
work and are not represented as fully converted by this one-folder test.

The hosted single PDF and job ZIP downloaded successfully; all five ZIP entries
were valid PDFs, including the two original uploads, with no JSON/CSV entries.
Native question dragging was saved in a private draft and verified after reopening.
The draft was moved to recoverable Trash without being published. Job and application
Archive/Trash/Restore retained files and AI results; cancelled emails were not replayed.
