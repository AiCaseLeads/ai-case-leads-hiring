# Hiring quick start

Open https://jobs.aicaseleads.com/team and sign in with your invited work Google account. Read the [six-page recruiter handbook](../public/recruiter-guide.pdf), which is also available from Settings.

The owner manages company connections and appoints head recruiters. Head recruiters invite/manage recruiters. All authorized recruiters can create/manage jobs, scorecards and applicant reviews. Each person connects their own interview calendar; no shared passwords are needed. Job assignment controls notifications, not visibility of hiring records.

## Create a job

Choose **Jobs → Create job**, or use **Create job** on Home. Pick a starting point:

- **Start blank:** add your own details.
- **Duplicate a job:** copy a prior posting into a new draft. Its applicants stay with the original posting.
- **Use a saved template:** reuse an approved description, questions and scorecard. Save a template from any job using **Save as template**.
- **From a hiring request:** complete the short internal request form, or choose a saved request. Turning a request into a job does not publish it automatically.

The setup has four steps:

1. **Details:** title, work arrangement, location, description and hiring team. Remote jobs can accept applicants worldwide or from a selected country. Hybrid/on-site jobs need a country and workplace city. Select the recruiters who should receive alerts and choose an applicant reply contact.
2. **Application:** name and email are always required. Each additional question has a Required/Optional dropdown. Add from the question library or add a custom question; answer formats and instructions are under a disclosure.
3. **AI review:** optionally enable automatic résumé and answer matching against the job description. No manual scorecard is required. Manual scorecards remain an optional tool for your team.
4. **Review:** check the description, questions and criteria. Save a draft or approve the preview and publish. Qualification rules and automatic rejection are separate advanced controls and remain off for new postings.

Use **Save draft** to pause setup. A draft needs a valid title, location and questions; unfinished custom criteria must be completed before saving them. **Save as draft (unpublish)** stops a currently published job accepting applications. **Edit job** updates that same posting and preserves its public address. **Duplicate job** creates a separate posting. **Previous postings** shows closed jobs. No batch number or batch name is required. Closing a job stops new applications and preserves its applicants and files. Legacy archive folder labels remain intact.

## Assign recruiters and route job emails

In **Settings → Team access & invitations**, invite each recruiter's work email so they can sign in with their own Google account. The owner can appoint a Head recruiter; head recruiters can invite other Recruiters. Invitations show queued, sent, failed or uncertain status; queued is not proof of delivery. Then choose **Jobs → Hiring team & emails** on a posting, or select its team in the first job-setup step. Recruiters can select multiple active staff per job, choose a reply contact, and save the changes in the dashboard. Hiring-team assignment controls alerts, not dashboard permissions; authorized recruiters still have access to all hiring records.

Toggle alerts for new applications, submitted assessments, applicant replies received in the connected mailbox, and overdue reviews. An empty saved team receives no alerts and does not fall back to sales. Saving a team does not send old application alerts. Duplicated jobs and templates start with an empty team so you can choose the people for the new posting.

The Google account connected in Settings remains the sender. The job's chosen recruiter and that connected mailbox are included in Reply-To. Applicants should use **Reply all** to keep their conversation available in the dashboard; messages sent only to a recruiter's personal inbox cannot be imported by the shared connection. Staff login alone does not connect that person's Gmail. See [email routing details](JOB-TEAM-NOTIFICATIONS.md).

## Home and applicant review

Home shows work to review, your job postings, recent applicants and a compact connection status. Technical delivery details are available through **Delivery activity**.

In **Applications**, choose the job whose applicants you want to review. Each posting keeps its own applications, including closed postings. Use **Top 10 AI matches** to see the highest completed scores for that job, or filter by stage and qualification. Unscored applicants remain available in the full list. Clear filters keeps you within the selected job; Back to jobs returns to the job chooser. Bulk downloads support a spreadsheet of application data and a ZIP of original uploaded files. Choose the filtered set or select individual applicants before downloading.

Applicant records have three views:

- **Application & files:** answers, private original uploads, Drive link and qualification evidence.
- **AI review & notes:** job-match score and evidence, with optional manual reviewer grades and verification checks.
- **Activity & messages:** assessments, interviews, earlier reviews, notes, emails and hiring history.

Unsaved evidence and scorecard drafts survive switching these views. Reloading the entire browser or leaving the applicant can lose unsaved entries. The action panel records notes, assigns reviewers and explicitly sends assessments/interview booking links. Moving a stage alone sends no invitation.

Browser Back/Forward follows dashboard sections, applicant profiles and job-setup steps. Returning from an applicant restores the applied filters and list page; opening from Home returns to Home. A direct applicant link closes into Applications. Job details remain while moving backward and forward inside the same setup; save a draft before reloading or leaving for another section. A pending save can finish on the server even if you navigate back, but its response cannot close a newer setup.

## Personal and company setup

**Settings → My setup → My interview calendar** is available to every staff member. Choose **Connect my Google Calendar**, approve the connection using the same account used to sign in, and save your own interview hours, time zone, days, duration, notice period and booking horizon. Calendar authorization is separate from dashboard login. Only the account holder can finish Google sign-in/consent; no owner password or new API key is needed.

When sending a booking link, explicitly choose **Who will conduct this interview?** A recruiter is available only after connecting their calendar and saving their hours. The shared company calendar is an explicit alternative. Existing invitations keep their original interviewer/calendar, including during rescheduling and cancellation. Reconnecting a personal calendar must use the same email; a failed personal connection never silently switches the booking to the company calendar.

**Settings → Company setup** is owner-only. The existing company sender and shared Drive archive remain connected as sales@aicaseleads.com. They are separate from personal interview calendars. Recruiters do not need to reconnect the company account or change the archive root. The legacy shared calendar retains the approved Monday-Friday, 10:00-16:00 America/Bogota, 30-minute schedule until the owner changes it.

**Team access & invitations** appears for head recruiters and the owner. **Scorecard templates** are available to recruiting staff. Company AI credentials and hosting controls are restricted to the owner. Connection status is not proof of email, calendar or archive delivery; inspect Delivery activity and the actual record.

## Scorecards and the shortlist

Reusable scorecards can be created during job setup or under **Settings → Scorecard templates**. Name the scorecard and add your approved job-related criteria. Rating descriptions and weights are optional advanced controls. Assign a saved scorecard when creating/editing a job or in the library assignment form.

For each candidate, open **Review & scorecard**, choose a score and record supporting evidence for every criterion. The server computes the weighted mean without rounding: equal-weight scores 3 and 4 produce 3.5/5 = 70/100. Missing evidence calls for a follow-up, not an invented score. Each reviewer's latest overall review counts once, with equal weight across reviewers. Ungraded applicants remain ungraded. Compare applicants to the same posting using the same approved criteria.

Qualification rules report requirements met, unmet or needing review separately from reviewer grades. AI never changes the grade, stage or hiring outcome. No score automatically rejects anyone.

Editing a scorecard creates a new version. Existing jobs retain their assigned version until an authorized recruiter explicitly changes it. Saved reviews retain the complete original criteria, rating definitions and evidence. Archiving prevents new assignments while preserving existing ones.

## PDF reading, OCR and optional AI evidence review

In **Review & scorecard → Compare résumé, profile and application with AI**, the selected uploaded PDF is read automatically into a private preview. Text-based documents use PDF.js; scanned or mixed pages use local English/Spanish OCR. No additional OCR API key is needed. Original files remain private and unchanged.

Automatic reading supports PDFs up to 10 MB and 30 pages, including at most eight OCR pages. Text is capped at 30,000 characters. Incomplete extraction is visibly marked. One read runs at a time, with a 45-second deadline; busy reviewers can retry. Extraction never blocks application submission. OCR can misread names, dates and columns, so inspect the original before grading. Password-protected, unsupported or unreadable files offer manual excerpts as a fallback. See [PDF limits](PDF-READING.md).

Under **Settings → AI evidence review**, an OpenRouter key enables optional reviewer-requested OpenAI GPT-5 Mini evidence summaries. The key is encrypted and never returned to the browser. Set an OpenRouter spending limit. This is separate from PDF/OCR reading, which runs locally.

Confirm the PDF preview, enter the same approved job requirements used for the posting, and explicitly approve sharing selected text/answers with OpenRouter/OpenAI before generating. Use editable excerpts to remove unrelated personal information if needed. Candidate-supplied profile excerpts are optional; LinkedIn profiles are not scraped. The AI result saves as an audited note and queues Drive archival. It quotes supplied sources and suggests follow-ups; it does not verify employment or detect AI authorship. Check citations before interpreting them.

## Verification and reminders

Use **Record verification checks** to record timeline comparisons, portfolio contribution, a live job-related work sample and consented references. Record actual evidence and candidate explanations. Tailored or AI-assisted writing is not proof of fraud.

Home's overdue queue lists applications in Application Review with no scorecard after the configured waiting period (currently 48 hours). Notes and AI summaries do not count as completed human reviews. This is an initial-review queue: an existing scorecard removes a candidate even if they return to Application Review later.

**Settings → Review reminders** controls the waiting period, fallback managers and daily staff emails. Configured job teams receive overdue reminders for their postings when both the global reminder switch and that job's overdue toggle are enabled. Jobs without a saved team retain the earlier behavior: assigned active reviewers receive their own queue and selected managers cover unassigned/unavailable owners. At most one digest per recipient per Bogotá calendar day is queued. Staff reminders never message candidates. Delivery activity shows Gmail processing status. Interview reminders are separate.

## Storage and recovery

Applications and private files save on the Railway volume before Gmail or Drive work runs. Each accepted application queues a shared Drive archive independently; provider outages cannot erase an accepted application. A repeated job keeps previous postings/applicants and their folders. Files are available to authorized staff from the applicant record and the shared Drive location.

The worker drains ready tasks sequentially, checking every five seconds while busy and once per minute while idle. Provider quotas can delay delivery; check Delivery activity for intervention. Isolated load tests measure intake/storage, not Google's quotas. Railway backup snapshots are enabled; restoration still needs an isolated recovery test.

## Design references

The guided setup and starting choices use patterns documented in [Recruitee job creation](https://support.recruitee.com/en/articles/1066242-create-a-new-job), [job templates](https://support.recruitee.com/en/articles/10233676-how-to-use-job-templates) and [hiring requests](https://support.recruitee.com/en/articles/6999536-use-requisition-approvals-in-your-hiring-process). This app remains a custom system; no Recruitee subscription is required.
