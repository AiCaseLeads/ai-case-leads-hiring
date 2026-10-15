"""Build the public, non-sensitive recruiter handbook. Requires reportlab."""
from pathlib import Path
from reportlab.lib import colors
from reportlab.lib.enums import TA_LEFT
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
from reportlab.lib.units import inch
from reportlab.platypus import SimpleDocTemplate, Paragraph, Spacer, Table, TableStyle, PageBreak, KeepTogether

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / 'public' / 'recruiter-guide.pdf'
TEAL = colors.HexColor('#203F43')
GREEN = colors.HexColor('#D7ECDC')
INK = colors.HexColor('#223438')
MUTED = colors.HexColor('#53686B')
PALE = colors.HexColor('#F2F6F4')
styles = getSampleStyleSheet()
styles.add(ParagraphStyle(name='KickerA',fontName='Helvetica-Bold',fontSize=9,leading=12,textColor=MUTED,spaceAfter=12))
styles.add(ParagraphStyle(name='TitleA',fontName='Helvetica-Bold',fontSize=27,leading=30,textColor=TEAL,spaceAfter=13))
styles.add(ParagraphStyle(name='IntroA',fontName='Helvetica',fontSize=11.5,leading=16,textColor=INK,spaceAfter=13))
styles.add(ParagraphStyle(name='HeadingA',fontName='Helvetica-Bold',fontSize=13,leading=17,textColor=TEAL,spaceBefore=10,spaceAfter=6))
styles.add(ParagraphStyle(name='BodyA',fontName='Helvetica',fontSize=10.5,leading=14,textColor=INK,spaceAfter=7))
styles.add(ParagraphStyle(name='SmallA',fontName='Helvetica',fontSize=9,leading=13,textColor=MUTED,spaceAfter=5))
styles.add(ParagraphStyle(name='TableA',fontName='Helvetica',fontSize=10,leading=13,textColor=INK))
story=[]
def p(text,style='BodyA'):
    return Paragraph(text,styles[style])
def text(value,style='BodyA'):
    story.append(p(value,style))
def heading(value):text(value,'HeadingA')
def step(number,title,body):
    story.append(KeepTogether([p(f'{number:02d}  {title}','HeadingA'),p(body)]))
def callout(title,body):
    box=Table([[p(title,'HeadingA')],[p(body)]],colWidths=[480])
    box.setStyle(TableStyle([('BACKGROUND',(0,0),(-1,-1),PALE),('BOX',(0,0),(-1,-1),0.5,GREEN),('LEFTPADDING',(0,0),(-1,-1),14),('RIGHTPADDING',(0,0),(-1,-1),14),('TOPPADDING',(0,0),(-1,0),3),('BOTTOMPADDING',(0,-1),(-1,-1),8)]))
    story.extend([Spacer(1,9),box])
def page(section,title,intro):
    if story:story.append(PageBreak())
    text('AI CASE LEADS  /  RECRUITER HANDBOOK','KickerA')
    text(section,'KickerA')
    text(title,'TitleA')
    text(intro,'IntroA')
def table(rows,widths):
    data=[[p(str(c),'TableA') for c in row]for row in rows]
    t=Table(data,colWidths=widths,hAlign='LEFT')
    t.setStyle(TableStyle([('BACKGROUND',(0,0),(-1,0),GREEN),('VALIGN',(0,0),(-1,-1),'TOP'),('LEFTPADDING',(0,0),(-1,-1),10),('RIGHTPADDING',(0,0),(-1,-1),10),('TOPPADDING',(0,0),(-1,-1),7),('BOTTOMPADDING',(0,0),(-1,-1),7),('LINEBELOW',(0,0),(-1,-1),0.5,colors.HexColor('#DEE6E2'))]))
    story.extend([t,Spacer(1,9)])

page('01 / START HERE','Your recruiting workspace','A practical guide to signing in, connecting your recruiting email and calendar, posting jobs and reviewing applicants.')
callout('Open your workspace','<link href="https://jobs.aicaseleads.com/team" color="#203F43">jobs.aicaseleads.com/team</link><br/>Use the work Google account that received your invitation. You do not need the owner\'s password or an API key.')
heading('Who does what?')
table([['Role','Responsibility'],['Owner','Company connections, hosting and access to head-recruiter controls.'],['Head recruiter','Recruiting team access, job postings and hiring operations.'],['Recruiter','Create and manage jobs, review applicants and arrange interviews.']],[115,365])
heading('Two different kinds of connection')
text('<b>My setup:</b> your own recruiting email, interview calendar and availability. Each recruiter approves their own Google connections.')
text('<b>Company setup:</b> shared Drive storage and the fallback calendar, managed by the owner. This connection does not send applicant email.')
heading('Where to find your work')
text('<b>Home</b> shows work needing attention. <b>Jobs</b> manages postings. <b>Applications</b> holds applicants, reviews and history. <b>Reports</b> shows hiring activity. <b>Settings</b> contains personal setup and permitted team controls.')
text('On a phone, use Menu to open these sections. Save unfinished job posts as drafts before leaving.','SmallA')

page("02 / MARIA'S TAKEOVER","Take over in five steps","Use your own invited work account. The owner does not need your password, and you do not need the owner's password.")
step(1,'Sign in as yourself','Open the invitation sent to your work account. Choose that exact Google account. Your role is Head recruiter, which lets you manage recruiters and jobs.')
step(2,'Connect your email and calendar','In Settings → My setup, choose Connect recruiting email and approve your own account. Then connect your Google Calendar, save your interview hours and check Ready for interviews.')
step(3,'Take ownership of each posting’s alerts','Open Jobs → Hiring team &amp; emails for each posting, including jobs the owner creates. Select yourself and the recruiters handling that role. Leave the owner unchecked if they should not receive alerts. Select the alert types you want, then click Save hiring team.')
step(4,'Choose the reply contact and reminders','Set Applicant reply contact to yourself. Under Settings → Team access &amp; invitations → Review reminders, remove sales from Fallback managers for older postings. Click Save review reminders.')
step(5,'Invite your team and test','Invite each recruiter from Team access &amp; invitations. They connect their own calendars. Run the practice-hire checklist at the end of this guide, including actual notification and Calendar checks.')
callout('Your mailbox owns recruiting conversations','Recruiter conversations use the connected recruiter mailbox. Automated messages use the approved no-reply alias on Maria’s account; replies to that alias are rejected. Add the alias in your own Gmail Send mail as settings and test delivery. Sales is not an applicant-mail fallback.')
text('When sending a booking link, choose yourself under Who will conduct this interview? Job-team selection does not automatically choose the interviewer.','SmallA')

page('03 / SETTINGS MAP','Which settings do I need?','Settings has four sections. You only see the sections allowed for your role; a missing owner section is not an error.')
table([['Section','Who uses it / what it changes'],['My setup','Recruiters connect their own Gmail and calendar, then save interview hours. Company Drive remains separate.'],['Team access &amp; invitations','Owner and head recruiter. Invite recruiters, manage their access and configure overdue-review reminders.'],['Scorecard templates','Recruiting staff. Maintain reusable criteria for consistent human reviews. Choose a template when preparing a job.'],['Company setup','Owner only. Drive archive, fallback calendar, default rejection email, AI configuration and technical setup.']],[155,325])
heading('A save button saves its own section')
text('<b>Save my interview hours</b> saves your personal availability. <b>Save review reminders</b> saves reminder rules. <b>Save hiring team</b> saves one job’s email routing. <b>Save settings</b> in Company setup saves its shared calendar, Drive folder and default rejection email.')
text('Connecting Google, sending an invitation, saving a scorecard template and configuring AI each have their own action. There is no one button that saves every Settings tab. Wait for its success message before leaving.')
callout('Three things people often mix up','<b>Access:</b> who can log in and work with hiring records.<br/><b>Job notifications:</b> who receives alerts for a particular posting.<br/><b>Interview calendar:</b> whose available times and Calendar event are used.<br/>Set each one deliberately. Adding a teammate does not subscribe them to every job.')
text('Daily work normally needs My setup, Jobs and Applications. The head recruiter uses Team access when staffing changes. Advanced admin setup is not part of a recruiter’s first-day checklist.','SmallA')

page('04 / MY SETUP','Your calendar, explained','Google sign-in verifies who you are. Connect my Google Calendar separately grants the hiring app access to your interview calendar.')
table([['Control','What it means'],['My time zone','The time zone for your working hours, such as America/Bogota or Europe/Madrid. Choose where your hours should be interpreted, not the applicant’s location.'],['Interview length','How long each appointment lasts. A full appointment must fit inside your available hours.'],['First available hour / Finish by','The earliest start and latest finish on your selected days. Example: 10:00 to 16:00 allows a 30-minute meeting ending at 16:00.'],['Days I interview','Only checked days can offer slots. Existing busy Calendar events also block times.'],['Minimum booking notice','How much advance notice you need. With 24 hours, an applicant cannot book a meeting that begins sooner than 24 hours from now.'],['Allow bookings ahead','How far into the future the applicant can book: for example, the next 14 days. This is not the interview duration.']],[160,320])
heading('Save and check readiness')
text('Click <b>Save my interview hours</b>. <b>Not connected</b> means you still need Google consent. <b>Save your hours</b> means the connection exists but your availability needs saving. <b>Ready for interviews</b> means both setup steps are complete.')
callout('Existing invitations keep their original hours','Changing your hours affects new booking invitations. Existing links keep the availability saved when issued; your real busy Calendar events are still checked. Choose the correct interviewer before sending a new link.')
text('Each person must approve their own account. If Google shows a different email, switch accounts. If the calendar stops working, reconnect as the same person and test again; the system does not silently substitute the sales calendar.','SmallA')

page('05 / TEAM ACCESS','Invitations and reminders','The head recruiter manages the recruiting team. The owner manages head-recruiter access and company connections.')
step(1,'Invite a recruiter','Enter Teammate’s Google Workspace email, select Their role and click Send invitation. The head recruiter can add recruiters; only the owner can appoint another head recruiter.')
step(2,'Check the invitation status','Use Refresh invitation status. Pending or running means delivery is still being processed. Sent means the sending service accepted it; it does not prove the person opened it, signed in or connected Google. Failed needs attention. Uncertain means delivery must be checked before sending again.')
step(3,'Manage access separately from job alerts','Remove access blocks the teammate’s dashboard access. Restore access enables it again. All authorized staff can access hiring records; assignment to a job routes alerts, not record visibility.')
heading('Review reminders: what the controls mean')
table([['Control','Effect'],['Remind after this many hours','How long an applicant can remain in Application Review without a human scorecard before becoming overdue. Notes and AI review do not count as a completed human review.'],['Send daily overdue-review emails','Enables staff digests. The in-app overdue queue remains available even when these emails are off. Digests are limited to one per person per day using Bogota time.'],['Fallback managers for older postings','Used for older postings without saved hiring-team settings when the reviewer is missing or unavailable. New job-team settings control their own email recipients.']],[165,315])
text('Click <b>Save review reminders</b>. These messages go to staff, never applicants. Recording a scorecard or moving the application to its next stage clears the initial-review queue.','SmallA')
callout('Avoid duplicate invitations','If delivery is pending, running or uncertain, do not repeatedly click send. Refresh the status and check Delivery activity or ask the owner to investigate. No one needs to share passwords.')

page('06 / SCORECARD TEMPLATES','Agree on what good looks like','A scorecard template is a reusable set of job-related criteria. It is not an AI model, a rejection rule or an automatic hiring decision.')
step(1,'Choose criteria for the work','Use Settings → Scorecard templates to prepare a reusable template. Give it a recognizable name, such as Creative Strategist - portfolio review. Define criteria that reviewers can support with evidence.')
step(2,'Set weights intentionally','A larger weight makes a criterion contribute more to the overall score. Agree on priorities before reviewing candidates. Avoid double-counting one skill under several similar criteria.')
step(3,'Attach a scorecard while preparing the job','Choose the reusable template in the job’s review-scorecard step. A template gives you a starting point; confirm the selected criteria suit that role before publishing. You can also choose manual review.')
step(4,'Review consistently','For each applicant, rate the criteria and record evidence. Compare candidates within the same posting using consistent criteria. Missing information is a follow-up question, not permission to invent a score.')
heading('What the applicant grade means')
text('The grade comes from human scorecards, using weighted criteria and the latest review from each reviewer. With equal weights, scores of 3/5 and 4/5 produce 3.5/5, or 70/100. An applicant with no completed grade stays ungraded.')
callout('Qualification, grade and AI are different','<b>Qualification:</b> results against configured application rules.<br/><b>Reviewer grade:</b> the human scorecard result.<br/><b>AI evidence review:</b> an optional summary and follow-up aid. It does not change the human grade or automatically reject someone.')
text('Use job-relevant evidence and document uncertainty. A polished resume or AI-assisted writing does not, by itself, prove dishonesty.','SmallA')

page('07 / COMPANY SETUP','Shared services, not your inbox','This owner-only section supports the whole hiring system. Maria and other recruiters normally leave these connections in place.')
table([['Setting','Purpose / important distinction'],['Shared Google connection','The company account archives files in Drive and supports the fallback calendar. Recruiting Gmail connections are separate, under My setup.'],['Shared fallback interview calendar','Used when Shared company calendar is explicitly chosen for an interview. Its calendar ID, time zone, days and hours do not change personal availability. A calendar ID alone does not grant access.'],['Shared Google Drive folder','The archive destination. The connected account needs permission to add files; the hiring team also needs Drive access. A saved folder is not proof that a file arrived.'],['Default rejection email','The starting message for new jobs. Existing jobs keep their own approved message. Saving text does not enable automatic rejection.']],[165,315])
heading('What Save settings covers')
text('Saves the shared calendar and availability, Drive folder and default rejection email above it. Google authorization is a separate action. Check the success message, then test the specific service you changed.')
heading('Other panels')
text('<b>AI evidence review:</b> optional provider/model configuration, managed by the owner. Recruiters should not paste API keys into job descriptions or applicant notes.<br/><b>Advanced admin setup:</b> Google client and background-processing setup. Leave to the owner or technical support.<br/><b>Recent access changes:</b> an audit of recorded configuration changes, not an applicant list.')
callout('Connected is not the same as completed','Confirm actual results: a test email in the intended inbox, a PDF in the matching Drive folder, and an event on the selected calendar. Delivery activity shows pending or failed background work. Accepted applications stay saved if Drive is temporarily unavailable.')

page('08 / CREATE A JOB','Publish a clear posting','Each posting has its own applicants. Reusing a job never removes earlier applications or their files.')
heading('Choose a starting point')
text('Open <b>Jobs → Create job</b>. Start blank, duplicate an existing job, use a saved template, or turn a hiring request into a draft. A request or duplicate is not automatically published.')
step(1,'Job details','Add the title, description, work arrangement and location. Remote jobs can be worldwide or country-specific; hybrid/on-site jobs need a workplace city. Select the hiring team and reply contact for this posting.')
step(2,'Application form','Name and email are required. Set every additional question to Required or Optional. Use the question library or add a custom question. Ask only for information needed to evaluate the role.')
step(3,'Review scorecard','Choose a reusable scorecard, create criteria for this role, or choose manual review. Agree on job-related criteria before reviewing applicants. Keep the same version when comparing people for one posting.')
step(4,'Review and publish','Check the public description, questions, team and scorecard. Save a draft while preparing. When ready, approve the preview and publish; then open View public job to check what applicants see.')
callout('Hiring again? Duplicate the job','Use Duplicate job to create a new posting. Pick the location and team for that new posting. Earlier applicants remain under the original posting, available through Previous postings. No batch number is required.')
text('Closing or unpublishing a job stops new applications and keeps its earlier records. Editing a job preserves that posting\'s public address. Automatic rejection is a separate advanced setting; do not enable it without approved rules.','SmallA')

page('09 / DESCRIPTION EDITOR','Format without fighting spaces','Use the visual Job description box in the job form. Write or paste your approved content, then use the toolbar to make it easy to scan.')
step(1,'Paste a clean starting point','Paste brings in plain text and removes outside styling. This avoids carrying strange fonts or spacing from Word, Google Docs or another job board. Your wording stays yours; review it before publishing.')
step(2,'Make the structure visible','Select a section title and choose Heading. Use Paragraph for regular body text. Select important words and choose Bold or Italic. Keep headings short and avoid making the entire description bold.')
step(3,'Use real lists','Use Bulleted list for responsibilities, skills or benefits. Use Numbered list when order matters, such as application steps. Let the list control handle numbering instead of inserting spaces to align items.')
step(4,'Remove extra blank space','Choose Clean up spacing to remove extra spaces and blank paragraphs. Check the result. Undo restores the previous version if you want the spacing back; Redo reapplies an undone edit.')
step(5,'Preview and save','Choose Preview to see the description with the same formatting used on the public job. Choose Back to editing to continue. Preview does not publish or save the job: finish the job form and save your draft or publish when ready.')
heading('A simple description structure')
text('<b>About the role</b> - a short overview of the work.<br/><b>What you will do</b> - a concise bulleted list.<br/><b>What you will bring</b> - approved requirements, separated from nice-to-haves.<br/><b>Location and working arrangement</b> - clear remote, hybrid or on-site expectations.<br/><b>How to apply</b> - any approved portfolio or work-sample instructions.')
callout('Formatting does not invent the job','The editor changes presentation, not the hiring requirements. Confirm salary, seniority, location and any mandatory criteria with the hiring manager before including them. Check the public page on a phone after publishing.')

page('10 / REVIEW APPLICANTS','Evidence first. People decide.','The shortlist is based on qualification rules and human scorecards. Optional AI review supports the reviewer; it does not make hiring decisions.')
step(1,'Read the application and original files','In Applications, select a posting and open a candidate. Application & files contains answers, original uploads, qualification evidence and the Drive archive link when ready.')
step(2,'Complete the scorecard','Open Review & scorecard. Rate every criterion and record supporting evidence. Check unclear points with the candidate; do not invent a score from missing information.')
step(3,'Compare like with like','Filter to one posting and use Highest reviewer grade first. The grade combines the latest human review from each reviewer. Ungraded applicants remain ungraded.')
heading('How a grade is calculated')
text('A scorecard uses weighted criteria. With equal weights, scores of 3/5 and 4/5 produce 3.5/5, or 70/100. Qualification results are displayed separately. A high grade is a review aid, not an automatic invitation or offer.')
heading('PDF reading and optional AI')
text('The evidence-review panel reads uploaded PDFs automatically. Scanned pages can use local OCR. Review extracted text against the original: OCR can misread dates, names and columns. Unreadable or unsupported files need manual excerpts.')
text('AI review requires an explicit reviewer action and approval to share the selected text. It summarizes evidence and follow-up questions. It does not prove employment history, detect AI authorship, scrape LinkedIn, change the grade or reject applicants.')
callout('Keep an audit trail','Record job-related notes, portfolio contribution checks, work-sample results and candidate explanations. Tailored or AI-assisted writing alone is not evidence of fraud.')

page('11 / INTERVIEWS & RECORDS','Move the applicant forward','Sending an assessment or booking link is an explicit recruiter action. Changing a stage alone does not send an invitation.')
step(1,'Choose the interviewer','Open the applicant\'s action controls and choose the interviewer whose connected calendar should be used. Confirm their calendar and availability are ready before sending the interview invitation.')
step(2,'Send the booking link','Use the interview invitation action. The applicant uses an emailed secure link to choose an available time. Calendar processing must complete before a booking has a confirmed Meet link.')
step(3,'Check the booking','Confirm the event is on the intended interviewer\'s calendar, the candidate has the correct local time, and the Meet link is present. Existing busy events should block those times.')
step(4,'Handle changes through the hiring flow','Use the available reschedule/cancel controls and confirm that Calendar catches up. Do not treat a pending cancellation or delivery failure as completed.')
heading('Where applications and PDFs live')
text('An accepted application and its original files save privately in the hiring system first. Drive archival runs separately. The archive is organized by job, location, posting and applicant; a later posting does not overwrite earlier applications.')
text('Use the applicant record to access originals and its Drive link. Google outages can delay an archive or email while the accepted application stays saved. Tell the head recruiter if an archive remains pending or failed.')
callout('Read delivery status, not just connection status','Connected means an account is authorized. It does not prove a particular email was delivered, a file archived or an interview booked. Inspect the record and Delivery activity when something is pending.')

page('12 / CONTROLLED LIVE TEST','Run one complete practice hire','After the head recruiter and interviewers have connected their accounts, run this checklist together before relying on the full workflow.')
text('Use a clearly labeled TEST ONLY posting, a synthetic resume and a test inbox controlled by your team. Do not use a real applicant or send a real offer. Tell participating recruiters they will receive test notifications.')
table([['Check','Pass condition'],['1. Access','Head recruiter signs in and can manage recruiters. A recruiter signs in and can create a job, without access to company credentials.'],['2. Posting','Create a draft, publish it and open its public page on desktop and phone.'],['3. Application','Submit the test resume and answers once. Confirm one saved applicant, original PDF and correct posting.'],['4. Alerts and archive','Assigned recruiters receive the correct job alert; unrelated recruiters do not. Open the matching shared Drive folder and PDF.'],['5. Review','Complete the scorecard and confirm the expected grade and saved evidence.'],['6. Assessment','Send a test assessment, submit it through the link and verify the saved response.'],['7. Interview','Select the connected interviewer. Book a free slot; confirm time zones, busy-time blocking, event and Meet link. Reschedule, then cancel and verify Calendar updates.'],['8. Closeout','Move the synthetic record through the intended internal stages, verify history, then close the test posting. Keep its records for the test audit.']],[112,368])
heading('If a step fails')
text('Stop that step and record the job, applicant, time and visible error. Check Delivery activity for pending or failed work. Avoid repeatedly sending invitations when delivery is uncertain.')
text('Personal Google authorization and the live delivery checks must be completed by the relevant account holders. Automated test results do not establish delivery into a real recruiter\'s inbox.','SmallA')

def chrome(canvas,doc):
    canvas.saveState()
    canvas.setStrokeColor(GREEN);canvas.line(54,49,558,49)
    canvas.setFont('Helvetica',8);canvas.setFillColor(MUTED)
    canvas.drawString(54,35,'AI CASE LEADS  |  jobs.aicaseleads.com')
    canvas.drawRightString(558,35,f'Recruiter guide  |  {doc.page}')
    canvas.restoreState()

OUT.parent.mkdir(parents=True,exist_ok=True)
doc=SimpleDocTemplate(str(OUT),pagesize=(612,792),rightMargin=54,leftMargin=54,topMargin=44,bottomMargin=62,title='AI Case Leads - Recruiter Guide',author='AI Case Leads')
doc.build(story,onFirstPage=chrome,onLaterPages=chrome)
print(OUT)
