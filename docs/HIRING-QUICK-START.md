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

Qualification rules report requirements met, not met or needing review. Manager scores are independent: each reviewer's latest1–5 score counts once with equal weight. A4/5 mean displays as80/100, not an80% prediction. Ungraded applicants remain ungraded. In Applications choose the job and batch, then **Highest reviewer grade first**. Use consistent job-related criteria and inspect supporting evidence.

## Optional OpenRouter review

Under **Team & settings → Optional AI evidence review**, paste an OpenRouter API key in the password field, enable manual reviews and save. The key is encrypted and never returned to the browser. Set a spending limit in OpenRouter. The fixed model is `openai/gpt-5-mini`, routed only to OpenAI without provider fallbacks. A saved key is not proof the provider accepts it.

In an applicant record open **Evidence & verification → Compare résumé, profile and application with AI**. Paste relevant résumé/profile excerpts, enter up to8 job requirements (one per line), confirm sharing with OpenRouter/OpenAI, and generate. The app sends selected stored application answers too, excluding recognized personal-data fields. Review source excerpts before sharing; free-text material can still include personal information.

This version does not automatically parse PDFs or scrape LinkedIn. Use candidate-supplied About/Experience text and the original file. AI output includes source-labelled quotes and follow-up questions, saves as an audited note, and queues Drive archival. It does not assign scores, change stage, or reject anyone. Unsupported quotes fail validation; even exact quotes still need human interpretation. Sources remain editable after recoverable errors; refreshing the record preserves the draft. Navigating away or reloading the whole browser loses unsaved drafts.

## Verification rather than an AI-writing verdict

Use **Record verification checks** to document timeline comparisons, portfolio contribution, a live job-related work sample, and consented reference checks. Record actual evidence and candidate clarifications. AI-assisted or tailored writing is not proof of fraud. LinkedIn content is self-reported too. No AI-authorship detector or automatic fraud score is implemented.

Useful next improvements: approved reusable scorecards for each job, structured work samples, and reminders for overdue human reviews. Backup snapshots are enabled; disaster recovery restoration remains untested.

## Design references

The job/template and simple pipeline patterns were informed by [Recruitee job templates](https://support.recruitee.com/en/articles/10233676-how-to-use-job-templates) and [Workable pipeline guidance](https://help.workable.com/hc/en-us/articles/4413312707991-Recruiting-pipeline-best-practices).
[LinkedIn's scraping restrictions](https://www.linkedin.com/help/linkedin/answer/a1341387/prohibition-of-scraping-software) informed the candidate-supplied profile flow.
[OpenAI's retired classifier explanation](https://openai.com/index/new-ai-classifier-for-indicating-ai-written-text/) informed the decision not to label applicants based on AI-writing detection.
