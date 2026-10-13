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
styles.add(ParagraphStyle(name='TitleA',fontName='Helvetica-Bold',fontSize=29,leading=33,textColor=TEAL,spaceAfter=17))
styles.add(ParagraphStyle(name='IntroA',fontName='Helvetica',fontSize=12,leading=18,textColor=INK,spaceAfter=16))
styles.add(ParagraphStyle(name='HeadingA',fontName='Helvetica-Bold',fontSize=14,leading=19,textColor=TEAL,spaceBefore=13,spaceAfter=6))
styles.add(ParagraphStyle(name='BodyA',fontName='Helvetica',fontSize=10.5,leading=15.5,textColor=INK,spaceAfter=8))
styles.add(ParagraphStyle(name='SmallA',fontName='Helvetica',fontSize=9,leading=13,textColor=MUTED,spaceAfter=5))
styles.add(ParagraphStyle(name='TableA',fontName='Helvetica',fontSize=10,leading=14,textColor=INK))
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
    story.extend([Spacer(1,9),box,Spacer(1,8)])
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

page('01 / START HERE','Your recruiting workspace','A practical guide to signing in, connecting your calendar, posting jobs and reviewing applicants.')
callout('Open your workspace','<link href="https://jobs.aicaseleads.com/team" color="#203F43">jobs.aicaseleads.com/team</link><br/>Use the work Google account that received your invitation. You do not need the owner\'s password or an API key.')
heading('Who does what?')
table([['Role','Responsibility'],['Owner','Company connections, hosting and access to head-recruiter controls.'],['Head recruiter','Recruiting team access, job postings and hiring operations.'],['Recruiter','Create and manage jobs, review applicants and arrange interviews.']],[115,365])
heading('Two different kinds of connection')
text('<b>My setup:</b> your own interview calendar and availability. Each recruiter signs in and approves their own Google connection.')
text('<b>Company setup:</b> the shared recruiting sender and Drive archive. These are managed centrally. Seeing a company email here does not mean that person must receive every job alert.')
heading('Where to find your work')
text('<b>Home</b> shows work needing attention. <b>Jobs</b> manages postings. <b>Applications</b> holds applicants, reviews and history. <b>Reports</b> shows hiring activity. <b>Settings</b> contains personal setup and permitted team controls.')
text('On a phone, use Menu to open these sections. Save unfinished job posts as drafts before leaving.','SmallA')

page('02 / FIRST SIGN-IN','Set up your account','Your invitation gives you a route into the workspace. Google sign-in verifies your identity; it does not automatically connect your calendar.')
step(1,'Open the invitation','Follow the workspace link and choose Sign in with Google. Select exactly the work email that was invited. If the wrong Google account appears, switch accounts.')
step(2,'Open My setup','Go to Settings and find your personal setup. Connect your own Google Calendar and approve the calendar permissions. No one else needs your password.')
step(3,'Set your availability','Choose your time zone, working days, interview hours and interview duration. Check the settings before saving. Available booking times must fit these hours and avoid existing calendar events. Changes apply to new booking invitations; existing links keep the hours saved when they were issued.')
step(4,'Check your job assignments','Open Jobs, choose Hiring team & emails on the relevant posting, and select the people who should receive its alerts. Choose an applicant reply contact. A posting can have several recruiters.')
step(5,'Head recruiter: add the rest of the team','Use Settings → Team access &amp; invitations to invite each recruiter by their work email. Each person completes their own sign-in and calendar setup. Do not share credentials.')
callout('Email and calendar are separate','Job alerts go to the selected team. Applicant emails use the company sender. Replies sent only to a personal inbox do not appear in the dashboard; applicants should use Reply all so the connected company mailbox receives the conversation too.')
text('All authorized staff can access hiring records. Job-team assignment routes notifications; it is not a restriction on who can view applicants.','SmallA')

page('03 / CREATE A JOB','Publish a clear posting','Each posting has its own applicants. Reusing a job never removes earlier applications or their files.')
heading('Choose a starting point')
text('Open <b>Jobs → Create job</b>. Start blank, duplicate an existing job, use a saved template, or turn a hiring request into a draft. A request or duplicate is not automatically published.')
step(1,'Job details','Add the title, description, work arrangement and location. Remote jobs can be worldwide or country-specific; hybrid/on-site jobs need a workplace city. Select the hiring team and reply contact for this posting.')
step(2,'Application form','Name and email are required. Set every additional question to Required or Optional. Use the question library or add a custom question. Ask only for information needed to evaluate the role.')
step(3,'Review scorecard','Choose a reusable scorecard, create criteria for this role, or choose manual review. Agree on job-related criteria before reviewing applicants. Keep the same version when comparing people for one posting.')
step(4,'Review and publish','Check the public description, questions, team and scorecard. Save a draft while preparing. When ready, approve the preview and publish; then open View public job to check what applicants see.')
callout('Hiring again? Duplicate the job','Use Duplicate job to create a new posting. Pick the location and team for that new posting. Earlier applicants remain under the original posting, available through Previous postings. No batch number is required.')
text('Closing or unpublishing a job stops new applications and keeps its earlier records. Editing a job preserves that posting\'s public address. Automatic rejection is a separate advanced setting; do not enable it without approved rules.','SmallA')

page('04 / REVIEW APPLICANTS','Evidence first. People decide.','The shortlist is based on qualification rules and human scorecards. Optional AI review supports the reviewer; it does not make hiring decisions.')
step(1,'Read the application and original files','In Applications, select a posting and open a candidate. Application & files contains answers, original uploads, qualification evidence and the Drive archive link when ready.')
step(2,'Complete the scorecard','Open Review & scorecard. Rate every criterion and record supporting evidence. Check unclear points with the candidate; do not invent a score from missing information.')
step(3,'Compare like with like','Filter to one posting and use Highest reviewer grade first. The grade combines the latest human review from each reviewer. Ungraded applicants remain ungraded.')
heading('How a grade is calculated')
text('A scorecard uses weighted criteria. With equal weights, scores of 3/5 and 4/5 produce 3.5/5, or 70/100. Qualification results are displayed separately. A high grade is a review aid, not an automatic invitation or offer.')
heading('PDF reading and optional AI')
text('The evidence-review panel reads uploaded PDFs automatically. Scanned pages can use local OCR. Review extracted text against the original: OCR can misread dates, names and columns. Unreadable or unsupported files need manual excerpts.')
text('AI review requires an explicit reviewer action and approval to share the selected text. It summarizes evidence and follow-up questions. It does not prove employment history, detect AI authorship, scrape LinkedIn, change the grade or reject applicants.')
callout('Keep an audit trail','Record job-related notes, portfolio contribution checks, work-sample results and candidate explanations. Tailored or AI-assisted writing alone is not evidence of fraud.')

page('05 / INTERVIEWS & RECORDS','Move the applicant forward','Sending an assessment or booking link is an explicit recruiter action. Changing a stage alone does not send an invitation.')
step(1,'Choose the interviewer','Open the applicant\'s action controls and choose the interviewer whose connected calendar should be used. Confirm their calendar and availability are ready before sending the interview invitation.')
step(2,'Send the booking link','Use the interview invitation action. The applicant uses an emailed secure link to choose an available time. Calendar processing must complete before a booking has a confirmed Meet link.')
step(3,'Check the booking','Confirm the event is on the intended interviewer\'s calendar, the candidate has the correct local time, and the Meet link is present. Existing busy events should block those times.')
step(4,'Handle changes through the hiring flow','Use the available reschedule/cancel controls and confirm that Calendar catches up. Do not treat a pending cancellation or delivery failure as completed.')
heading('Where applications and PDFs live')
text('An accepted application and its original files save privately in the hiring system first. Drive archival runs separately. The archive is organized by job, location, posting and applicant; a later posting does not overwrite earlier applications.')
text('Use the applicant record to access originals and its Drive link. Google outages can delay an archive or email while the accepted application stays saved. Tell the head recruiter if an archive remains pending or failed.')
callout('Read delivery status, not just connection status','Connected means an account is authorized. It does not prove a particular email was delivered, a file archived or an interview booked. Inspect the record and Delivery activity when something is pending.')

page('06 / CONTROLLED LIVE TEST','Run one complete practice hire','After the head recruiter and interviewers have connected their accounts, run this checklist together before relying on the full workflow.')
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
