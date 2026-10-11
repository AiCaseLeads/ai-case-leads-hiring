# Hiring quick start

Open https://jobs.aicaseleads.com/team and sign in with your approved work account.

## Jobs and batches

Go to **Jobs & batches**. Choose a job, a hiring location, then an existing batch. **Open batch** edits that same posting and keeps its application page. **Create new batch** copies its description and questions into a new draft and keeps all previous applications. A batch is one posting, not a folder that merges records from other postings.

Use **Create job** for a new job. Fill the title, location, batch name and description. Review the questions. Save a draft, or choose Open and approve the description/form to publish. Page addresses are generated; technical controls are under Advanced. Closing a batch stops new applications without deleting previous records.

Optional **Add experience & profile questions** adds an optional LinkedIn URL, experience summary, personal contribution to a work sample, and an accuracy confirmation. Review and save to apply it; existing public forms are not silently changed.

## Connect Google

**Team & settings** has three steps:
1. Connect the configured recruiting Google account. Currently sales@aicaseleads.com. Dashboard login is separate from the recruiting account.
2. Choose the interview calendar. The shortcut uses the connected account. Current approved availability is Monday-Friday,10:00-16:00 America/Bogota,30 minutes.
3. Paste the shared Drive folder link. The saved folder can be opened directly. Files use Recruiting → Job → Location → Batch → Applicant. Existing applicants keep their saved folder.

Click **Save team & settings** for calendar/folder changes. Changing to Maria's calendar requires event-editing access for the connected account, and no active/unresolved interview bookings. Changing the whole recruiting account requires the hosting administrator to update EXPECTED_RECRUITING_EMAIL and Maria to authorize Google. Do not give anyone the owner's login.

## Understand the shortlist

Qualification rules report requirements met, not met or needing review. Manager scores are independent: each reviewer's latest 1–5 score counts once with equal weight. A 4/5 mean displays as 80/100, not an 80% prediction. Ungraded applicants remain ungraded. In Applications choose the job and batch, then **Highest reviewer grade first**. Use consistent job-related criteria and inspect supporting evidence.

## Optional OpenRouter review

Under **Team & settings → Optional AI evidence review**, paste an OpenRouter API key in the password field, enable manual reviews and save. The key is encrypted and never returned to the browser. Set a spending limit in OpenRouter. The fixed model is `openai/gpt-5-mini`, routed only to OpenAI without provider fallbacks. A saved key is not proof the provider accepts it.

In an applicant record open **Evidence & verification → Compare résumé, profile and application with AI**. The selected uploaded PDF is read automatically into a private preview. Confirm the correct file, inspect the text, enter up to 8 job requirements (one per line), confirm sharing with OpenRouter/OpenAI, and generate. Candidate-supplied profile excerpts remain optional. The app also sends selected application answers, excluding recognized personal-data fields. PDF text can still include personal information: use **Use editable text instead** to remove unrelated material before sharing.

PDF reading supports text-based PDFs up to 10 MB and 30 pages. Only the first 30,000 characters are retained, with a visible partial-text notice if truncated. Scanned-image PDFs need a text-based replacement or manual excerpts; OCR is not enabled. Password-protected and unreadable files show recovery instructions. Originals remain private and unchanged. Two PDF reads can run at once; additional reviewers can retry. Extraction never blocks application submission. LinkedIn profiles are not scraped. AI output includes source-labelled quotes and follow-up questions, saves as an audited note, and queues Drive archival. It does not assign scores, change stage, or reject anyone. Unsupported quotes fail validation; even exact quotes still need human interpretation. Sources remain editable after recoverable errors; refreshing the record preserves the draft. Navigating away or reloading the whole browser loses unsaved drafts.

## Verification rather than an AI-writing verdict

Use **Record verification checks** to document timeline comparisons, portfolio contribution, a live job-related work sample, and consented reference checks. Record actual evidence and candidate clarifications. AI-assisted or tailored writing is not proof of fraud. LinkedIn content is self-reported too. No AI-authorship detector or automatic fraud score is implemented.

## Reusable scorecards

In **Jobs & batches → Reusable scorecards**, give the template a name, add your approved job-related criteria, and define what earns each score from 1 to 5. Save the template. In **Assign a scorecard to a batch**, choose the batch and template, then save. Criteria have equal weight in the editor.

Open an applicant's **Reusable scorecard review**, choose a score and add supporting evidence for every criterion, then save. The server computes the mean without rounding: 3 and 4 produce 3.5/5 = 70/100. Each reviewer's latest review counts once. Missing evidence should prompt a follow-up, not an invented score. No score automatically rejects an applicant.

Editing a template creates a new version. Existing batches remain on their selected version, and saved reviews keep the full original criteria, definitions and evidence. Archiving hides a template from new assignments but preserves existing ones. New batches need an explicit template assignment.

## Overdue review reminders

The **Overview → Overdue human reviews** queue lists applications still in Application Review without a scorecard after the configured waiting period. Filter all, assigned to me, or unassigned, and open the applicant directly. The default is 48 hours since entering Application Review. Notes and AI summaries do not count as completed human reviews.

In **Team & settings → Overdue human reviews**, set the waiting period, choose fallback managers, enable daily team emails, and save. Assigned active staff receive their own queue digest; selected managers cover unassigned or unavailable assignees. At most one digest per recipient per Bogotá calendar day is queued. These are staff reminders, never candidate messages. Gmail delivery status appears under Integration tasks. Disable the toggle to keep only the in-app queue.

This is an initial-review queue. An existing scorecard removes an applicant even if they later return to Application Review. Interview reminders remain separate. Email processing runs in the background and retries temporary failures; it does not block applications.

## Reuse work-sample instructions

Open a saved batch and expand **Optional: assessment instructions**. Use **Reuse assessment instructions from a saved batch** to copy a previous assessment, then edit and save it for the new batch. Include the task, expected deliverable, evaluation criteria and reasonable time guidance in your approved instructions. Saving never sends an assessment: a recruiter must explicitly invite the candidate.

## Operational limits

Applications and private uploads save before Drive or Gmail work runs. The worker drains ready tasks in sequential batches, checking again after five seconds while a backlog exists and once per minute while idle. Provider quotas and outages can delay delivery; review Integration tasks for errors. A load test measures isolated application/storage behavior, not Google's external quotas. Backup snapshots are enabled; disaster recovery restoration remains untested.

## Design references

The job/template and simple pipeline patterns were informed by [Recruitee job templates](https://support.recruitee.com/en/articles/10233676-how-to-use-job-templates) and [Workable pipeline guidance](https://help.workable.com/hc/en-us/articles/4413312707991-Recruiting-pipeline-best-practices).
[LinkedIn's scraping restrictions](https://www.linkedin.com/help/linkedin/answer/a1341387/prohibition-of-scraping-software) informed the candidate-supplied profile flow.
[OpenAI's retired classifier explanation](https://openai.com/index/new-ai-classifier-for-indicating-ai-written-text/) informed the decision not to label applicants based on AI-writing detection.
