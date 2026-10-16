# Automatic applicant review

AI matching compares the submitted résumé and saved application answers with requirements derived from the job description. It does not reject applicants or change their hiring stage.

## Processing and waiting

- Up to three provider requests run together. PDF/OCR extraction stays limited to one file at a time to protect server memory.
- The default limit is **120 provider requests per hour across all jobs**. Preparing requirements and actual provider retries count toward this limit. Missing/unreadable PDFs and local reader contention do not consume it.
- An administrator can change the hourly limit under **Company → AI connection → Processing capacity**. Increasing the limit permits more OpenRouter API usage; it does not guarantee a finish time. Changing the limit does not erase requests already used this hour.
- Each applicant’s AI section shows whether it is queued, processing, waiting to retry, paused by the provider, or paused until the hourly capacity resets. Queue counts show eligible reviews ahead, not a promised completion time.
- A temporary failure gets at most five attempts, with waits capped at five minutes unless the provider asks for a longer pause. A rejected key or insufficient credit stops automatic retries. Correct the connection/credit, then use **Review existing applicants** for the affected job. Completed reviews are retained.
- A provider rate limit pauses the whole AI queue instead of repeatedly trying other applicants against the same limit. A browser refresh does not spend AI credits.

## Editing jobs

Changing a job’s title or description requires new AI evidence against the new requirements. Reordering questions, changing location or team allocation, and other edits that leave the title and description unchanged retain completed reviews. Existing application answers and question labels remain the original submission snapshot.

Archived applications in Trash are excluded from new review work. Old job versions do not count as current failures, and a stale worker cannot save evidence or spend credits after its processing lease has been replaced.
