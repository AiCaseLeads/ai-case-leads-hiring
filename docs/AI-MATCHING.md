# AI job matching

In a job’s **AI review** step, enable **Use AI to score and rank applicants for this job**, then save the job. Manual scorecards are optional. Existing jobs remain off until their hiring team enables matching.

Alternatively, in **Applications**, select a job, apply the filter, and enable **Automatically review applicants for this job**. Choose **Highest AI match first** and apply filters to compare completed reviews. The company AI connection is managed in **Settings → Company setup → AI connection**.

## What the score means

OpenAI GPT-5 Mini through OpenRouter extracts up to eight explicit job-related requirements from the job description. The same requirements are used for every applicant to the current version of that job. AI checks résumé text and eligible application answers for evidence satisfying each complete requirement, including numeric minimums. Exact source quotations must validate before the review is saved.

The app computes `supported requirements / total requirements × 100`, with equal weight for each requirement. This is evidence coverage, not a prediction of performance or a hiring decision. The highest scores sort first within a selected job. Ties are expected. Human grades and qualification/rejection rules remain separate. AI never changes the application stage or sends rejection messages.

Missing, ambiguous, unreadable or incomplete résumé extraction produces an unscored manual-review result. Pending, failed and obsolete results are not zero scores. Read original files and clarify missing information with applicants. The model can make mistakes even when a quotation is real.

## Operations

Matching runs in its own durable background loop, separately from Google mail/calendar tasks. Automatic matching processes applications for enabled jobs, including existing applications. **Review existing applicants** explicitly retries failed/manual-review outcomes and reconciles missing work; completed current-version results are reused. The worker has a shared lease, five automatic attempts, provider timeouts and a 120-attempt hourly budget. A burst is queued instead of delaying application acceptance.

Saving a job conservatively increments its version and invalidates previous match scores. Requirements and results are rebuilt for enabled jobs. A failed requirements build is shown as failed in the job and applicant views. Configuration failures direct the team to the AI connection settings.

Results include evidence and model information in application history, with a new Drive archival task. Company-level disabling stops future AI processing. Per-job disabling removes that job’s AI score from the current comparison. Historical reviews remain part of the hiring record.
