# Your recruiting setup and first job test

**For the standalone Railway edition, use [Railway setup](RAILWAY-SETUP.md).** This document describes the retained Sites installation.

Recruiting Google account: **mariam@aicaseleads.com**.
Private hiring hub: https://ai-case-leads-careers.abloomcharm1.chatgpt.site/team
Public domain prepared: https://jobs.aicaseleads.com (DNS/TLS still pending).
The current careers-page hosting audience is public. The hiring hub requires authorized staff sign-in, and intake remains paused until the controlled checks below pass.

## What needs to be linked

| Connection | Why it is needed | Where to configure |
|---|---|---|
| Google OAuth client and account grant | Authorizes Gmail, Calendar/Meet and Drive | Team & settings → Google connection setup |
| Recruiting calendar | Availability and actual meeting invitations | Team & settings → Calendar |
| Restricted recruiting Drive folder | Application files and complete history exports | Team & settings → Drive |
| Apps Script scheduler | Processes email/calendar/archive tasks while nobody has the hub open | Team & settings → Background task processing |
| Manager/recruiter identities | Private dashboard access | Team & settings → Hiring team (hosting audience also applies if the whole site is restricted) |
| DNS | Makes the branded public address work | Your domain's DNS panel |
| Approved job content and intake switch | Lets candidates see and submit to real openings | Roles & forms, then hosted intake configuration |

No Ashby account is required. Google Workspace supplies the connected services; hiring records, forms, rules, reviews and dashboard are custom. Dashboard sign-in still uses Sites/ChatGPT identity; the Google grant is a separate service connection.

## 1. Connect Google securely

Sign into the hub as the owner and open **Team & settings**.

1. Copy the displayed callback URI. For the current preview it is:
   `https://ai-case-leads-careers.abloomcharm1.chatgpt.site/api/google/callback`.
2. Sign into [Google Cloud Console](https://console.cloud.google.com/) with an account permitted to administer the Workspace project. Use a recruiting project; enable **Gmail API**, **Google Calendar API**, and **Google Drive API**.
3. Configure the Google Auth Platform audience as **Internal** for this Workspace organization when available. Set the app name and support contact. Create an OAuth client of type **Web application**, using the exact callback URI above.
4. Paste the client ID and secret into the hub's dedicated setup fields and save them. **Do not paste secrets into chat.** The secret field clears after saving; credentials are encrypted on the server.
5. Open the hub in a normal Chrome or Edge browser for Google authorization if the in-app preview is blocked. Select **Connect Google Workspace**, choose **mariam@aicaseleads.com**, grant the requested permissions, then check that the hub displays that exact connected sender.
6. If Google says your organization blocked the app, the Workspace administrator must allow that OAuth client. If the audience is External/Testing, resolve publishing/token-lifetime requirements before relying on unattended use.

Google requires exact redirect matching and account authorization. [Google OAuth setup](https://developers.google.com/identity/protocols/oauth2/web-server).

## 2. Choose Calendar and Drive

In Google Calendar, create a recruiting calendar or select the existing one. Ensure mariam@aicaseleads.com can create and change its events. Calendar **Settings and sharing → Integrate calendar → Calendar ID** contains the ID. Paste it into the hub, then approve time zone, weekdays, hours and duration. The current default is America/Bogota; choose the actual team's scheduling zone. [Google Calendar instructions](https://support.google.com/calendar/answer/44105).

In Drive, create or select a restricted **Recruiting** root folder accessible only to the intended hiring team. Copy the folder ID from the URL after `/folders/` and save it in the hub. Verify actual membership, including any shared-drive or domain-wide access.

Use the correct destinations before creating bookings or archives. Once data exists, changing destinations is protected to prevent leaving old events or file mappings behind.

## 3. Enable background processing

Download the scheduler from the hub. In a standalone [Apps Script project](https://script.google.com/) owned by mariam@aicaseleads.com, paste that source and set the properties shown by **Show scheduler configuration**. The values belong only in Apps Script's **Project Settings → Script properties**.

A private Site also needs supported host service authentication; the task secret alone cannot bypass the private hosting sign-in. Validate the service token's lifetime and renewal. Run **installWorkspaceScheduler**, authorize the project, verify exactly one trigger, then run **runHiringQueue** manually and observe a genuine scheduled run.

Verify completed hub tasks and useful health status, not just an HTTP success. Use **Integration tasks → Process pending tasks** as the manual fallback. Actual quotas depend on the Google account and workload. [Apps Script quotas](https://developers.google.com/apps-script/guides/services/quotas).

## 4. Post your own test job

This is the owner-led test; it has not happened merely because automated tests pass.

1. Open **Roles & forms → Create role**.
2. Use a clear temporary title such as **Recruiting system test — do not apply** and a unique slug. Add your description, location/work arrangement, application questions, and a short assessment prompt.
3. Keep it **Draft** and automatic rejection **Off**. Save, reopen, and confirm your exact content persisted.
4. Add one testable qualification rule against an answer field. Use only an approved job requirement; the rule must explain its reason.
5. Approve a controlled test window and its permitted test audience before opening this temporary role and enabling intake. The current site audience is public; changing it to a restricted staging audience requires an explicit hosting access change. Keep public intake paused until that test scope is agreed.
6. Open the applicant website in a separate browser session. Confirm your role appears and that the description/questions match.
7. Submit an authorized test application using an inbox you control, a real PDF/DOCX resume, and distinct sample answers. Verify the receipt, then check **Applications** in the hub.
8. Confirm name/email, exact answers, original file, source, qualification evidence, and initial **Ungraded** state.
9. Repeat a simulated lost-response retry and verify there is still one application.
10. Have two authorized reviewers enter scorecards. Check the grade, reviewer count, notes and same-job top-applicant sorting.
11. Initiate an assessment, submit it through the private emailed link, then issue a second assessment and verify both remain visible and archived.
12. Initiate an interview. Book a slot, check the actual Google invitation and Meet link, reschedule, cancel, and verify both Google and hub agree. Test link renewal and availability-outage behavior separately.
13. Verify Gmail acknowledgment, a manual message, one rejection for a decision, and a reply with an attachment. Check the matching communication and original file.
14. Open the application's Drive folder and confirm answers, full assessment/interview history, communication history, and originals.
15. Close the temporary role and restore paused intake after testing. Keep the test record clearly labeled; do not use real applicants for failure simulations.

The manager should also try a second stale browser tab and confirm obsolete settings/decision saves are rejected. Test a recruiter and an unauthorized account separately.

## How grading identifies top applicants

**Qualification** and **grading** are separate:

- Rules check explicit application answers against approved requirements and show supporting values/reasons. They return **Pass**, **Needs review**, or **Fail**. They do not read a resume and infer quality.
- A manager/recruiter reviews the resume, portfolio, answers and assessment, then deliberately selects an overall **1–5** score and records criteria/evidence.
- Each reviewer's latest overall score counts once. Two reviewers with 4 and 5 display **4.5/5**; the underlying data also provides the equivalent **90/100**.
- No scorecards means **Ungraded**, not zero. One review is visibly less review coverage than two or three.
- The top-applicant sort compares reviewed candidates within one selected job. Qualification and stage remain visible; rankings do not automatically reject or hire anyone.
- The displayed percent is a normalized human review score. It is not an AI confidence score or a measured likelihood of success.

Suggested anchors to approve with the team: 1=clear mismatch against the posted criteria; 2=important gaps; 3=meets expectations with questions; 4=strong evidence; 5=exceptional evidence against the same criteria. Use role-specific evidence: do not compare an engineer's score with a creative strategist's score. No mandatory qualifications, compensation, or seniority are invented.

## 5. Connect jobs.aicaseleads.com

The host registration is prepared; DNS records are still pending. The current nameservers are `ui-dns` servers, so start in the domain's existing DNS panel.

| Type | Name | Value |
|---|---|---|
| CNAME | jobs | custom-domains.chatgpt.site. |
| TXT | _openai-site-verification.jobs | openai-site-verification=c-2PQ7Xd3uiAjYGA7HaUa1Ap92amuHdEPL_nz3PqDRI |
| TXT | _cf-custom-hostname.jobs | f620f1f7-bfbf-4e33-b437-ecd03e92cfbe |

These are DNS verification values, not application credentials. Avoid creating conflicting A/AAAA/CNAME records at the jobs hostname. Once records resolve, verify host status and TLS.

Before public launch, add and verify the exact new callback:
`https://jobs.aicaseleads.com/api/google/callback`.
Update the application-link origin and scheduler origin to the approved domain. Preserve private dashboard authorization while the applicant careers pages are public.

Approve the final applicant privacy/retention notice, real role content, access membership and controlled live-test results before opening public intake. Cosmetic polish and additional workflows are separate from proving real deliveries and bookings.
