"""Build the public, non-sensitive recruiter handbook. Requires reportlab."""
from pathlib import Path
from reportlab.lib import colors
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
from reportlab.platypus import SimpleDocTemplate, Paragraph, Spacer, Table, TableStyle, PageBreak, KeepTogether

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "public" / "recruiter-guide.pdf"
TEAL = colors.HexColor("#203F43")
GREEN = colors.HexColor("#D7ECDC")
INK = colors.HexColor("#223438")
MUTED = colors.HexColor("#53686B")
PALE = colors.HexColor("#F2F6F4")
WIDTH = 504
styles = getSampleStyleSheet()
for name, font, size, leading, color, after in [
    ("KickerA", "Helvetica-Bold", 9, 12, MUTED, 9),
    ("TitleA", "Helvetica-Bold", 27, 31, TEAL, 13),
    ("IntroA", "Helvetica", 11.5, 16, INK, 14),
    ("HeadingA", "Helvetica-Bold", 13, 17, TEAL, 6),
    ("BodyA", "Helvetica", 10.5, 14, INK, 8),
    ("SmallA", "Helvetica", 9, 12, MUTED, 6),
    ("TableA", "Helvetica", 10, 13, INK, 0),
]:
    styles.add(ParagraphStyle(name=name, fontName=font, fontSize=size, leading=leading,
                              textColor=color, spaceAfter=after, spaceBefore=9 if name == "HeadingA" else 0))
story = []

def p(value, style="BodyA"):
    return Paragraph(value, styles[style])

def text(value, style="BodyA"):
    story.append(p(value, style))

def heading(value):
    text(value, "HeadingA")

def step(number, title, body):
    story.append(KeepTogether([p(f"{number:02d}  {title}", "HeadingA"), p(body)]))

def callout(title, body):
    box = Table([[p(title, "HeadingA")], [p(body)]], colWidths=[WIDTH])
    box.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, -1), PALE), ("BOX", (0, 0), (-1, -1), .5, GREEN),
        ("LEFTPADDING", (0, 0), (-1, -1), 14), ("RIGHTPADDING", (0, 0), (-1, -1), 14),
        ("TOPPADDING", (0, 0), (-1, 0), 2), ("BOTTOMPADDING", (0, -1), (-1, -1), 7),
    ]))
    story.extend([Spacer(1, 7), box])

def page(section, title, intro):
    if story:
        story.append(PageBreak())
    text("AI CASE LEADS  /  RECRUITER HANDBOOK", "KickerA")
    text(section, "KickerA")
    text(title, "TitleA")
    text(intro, "IntroA")

def table(rows, first=142):
    data = [[p(str(cell), "TableA") for cell in row] for row in rows]
    box = Table(data, colWidths=[first, WIDTH-first], hAlign="LEFT", repeatRows=1)
    box.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, 0), GREEN), ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("LEFTPADDING", (0, 0), (-1, -1), 10), ("RIGHTPADDING", (0, 0), (-1, -1), 10),
        ("TOPPADDING", (0, 0), (-1, -1), 7), ("BOTTOMPADDING", (0, 0), (-1, -1), 7),
        ("LINEBELOW", (0, 0), (-1, -1), .5, colors.HexColor("#DEE6E2")),
    ]))
    story.extend([box, Spacer(1, 8)])

page("01 / MARIA'S FIRST DAY", "Take over recruiting", "Use your own invited work Google account. No shared passwords or API keys are needed to recruit.")
text('<link href="https://jobs.aicaseleads.com/team" color="#203F43"><b>Open jobs.aicaseleads.com/team</b></link>')
step(1, "Sign in", "Open your invitation and choose the work account that received it. Head recruiter access lets you manage recruiters and job postings.")
step(2, "Connect email and Calendar", "Open <b>Settings > My connections</b>. Connect Gmail for your personal recruiter conversations, then Google Calendar. Automatic receipts and rejections use SendGrid, not your Gmail. Save your interview days, hours and time zone. <b>Ready for interviews</b> means calendar setup is saved; a test booking confirms it works.")
step(3, "Choose who receives each job's alerts", "Open <b>Jobs > Actions > Hiring team &amp; emails</b>. Select the recruiters for that posting and its applicant reply contact. Leave the owner unselected when they should receive no job notifications. Save the hiring team.")
step(4, "Invite your recruiters", "Open <b>Settings > Team</b>. Enter each person's work email and send their invitation. They sign in and connect their own accounts. Only the owner can appoint another head recruiter.")
step(5, "Run the practice hire", "Use the checklist on page 6 with a clearly marked test posting and a team-owned test inbox. Check the actual email, Drive file and selected calendar, including cancellation.")
callout("Three settings with different jobs", "<b>Access</b> controls who can sign in. <b>Hiring team</b> controls each posting's notifications. <b>Interviewer</b> controls whose Calendar offers booking times. Job assignment does not restrict access to hiring records.")

page("02 / CREATE A JOB", "Four steps to a posting", "Start with an existing job or template when possible. Earlier applicants always stay with their original posting.")
text("Open <b>Jobs > Create job</b>: choose <b>Start from scratch</b>, <b>Duplicate an existing job</b>, <b>Use a template</b>, or <b>Use a hiring request</b>.")
step(1, "Job details", "Add the title, description and work arrangement. Remote jobs can be worldwide or country-specific; hybrid/on-site roles need a city. Use Bold, headings and real lists in the description editor. <b>Clean up spacing</b> removes extra blank space; preview before publishing.")
step(2, "Application questions", "Name, email and phone are required. Set additional questions to <b>Required</b> or <b>Optional</b>. Drag a question by its handle to change its position. Open instructions only when needed. Use number or yes/no questions for objective screening, such as a minimum of seven years.")
step(3, "Review setup", "Choose <b>Rank applicants with AI</b> if wanted. Open <b>Hiring team and notifications</b> to assign alerts and a reply contact. Manual reviewer scorecards are optional and do not control the AI score.")
step(4, "Publish", "Check the posting summary, then publish when ready. Open <b>View public job</b> to verify the live description and form. Automatic rejection emails require enabled screening rules and verified SendGrid setup under Company.")
heading("Save as you go")
text("Use <b>Save draft job</b> for an unpublished posting. Draft recovery and autosave protect progress, but check the saved status before leaving. Back moves between setup steps. If prompted about unsaved changes, save or explicitly discard them.")
callout("Keep the Jobs list clean", "<b>View applicants</b> opens one posting's candidates. <b>Edit job</b> changes that posting. <b>Pause/Resume</b> is on the job row. <b>Actions</b> holds Archive, Delete, Duplicate and team settings. Open <b>Archived</b> or <b>Trash</b> to find saved jobs; Restore leaves them paused. No applicant files are deleted.")

page("03 / APPLICANTS", "Review, shortlist, invite", "Open Applications, choose a job, then review that posting's applicants. Use stage tabs or Top 10 AI matches to focus the list.")
table([("Label", "What it means"),
       ("New", "A recruiter has not moved this application forward yet. AI scoring does not move it."),
       ("Shortlisted", "A recruiter selected the applicant for further consideration."),
       ("No screening rules", "This application had no configured rule decision. It is not a failed AI review."),
       ("Check answers", "Configured screening rules could not produce a clear pass or fail. Inspect the answers and rule evidence."),
       ("AI match score", "A job-specific match based on supplied resume text and answers. It is separate from screening and pipeline stage.")])
heading("The fast path")
text("<b>Shortlist</b> on a New applicant saves the stage change in one click. You can also select applicants and choose <b>Shortlist selected</b>. Shortlisting alone sends no candidate email.")
text("<b>Request interview</b> opens the booking invitation controls. Select a ready interviewer, then click <b>Send booking link</b>. If their calendar is not ready, ask that person to complete My connections. A request is not a confirmed appointment.")
heading("Three views inside an applicant")
text("<b>Application &amp; files:</b> answers, original PDFs, screening evidence and Drive archive link.<br/><b>AI review &amp; notes:</b> AI overview, expandable source quotes and recruiter notes. Human scorecards are optional.<br/><b>Activity &amp; messages:</b> recorded decisions, communications, assessments and interview activity.")
callout("Keep the next action clear", "Use Add note for an important observation. Assign a recruiter when ownership is unclear. Confirm the actual interview event and Meet link after booking; check Delivery activity if processing stays pending.")

page("04 / AI MATCHING", "Understand the evidence", "AI helps prioritize a job's applicants. The recruiting team chooses who is shortlisted, interviewed or hired.")
heading("What the AI reads")
text("OpenAI through OpenRouter compares the job description with the applicant's resume text and answers. PDFs are read automatically; scanned pages can use local OCR. AI matching must be enabled for the job and the OpenRouter AI connection must be configured.")
heading("Read the overview first")
text("The applicant's AI review shows the overall score, job-related strengths and missing or unclear evidence. Open <b>View source evidence</b> to see requirements and the exact supplied text behind them. Open <b>Source limitations</b> when extraction or missing documents affect the result.")
table([("AI result", "Your next step"),
       ("Evidence found", "Compare the quoted source with the requirement. A candidate's statement still needs appropriate verification."),
       ("Needs clarification", "Ask a focused follow-up or use a job-related work sample."),
       ("Evidence not found", "Check the original resume and answers. Missing evidence does not prove the person lacks the skill."),
       ("Pending / failed", "Wait for processing or inspect the visible error. Do not treat an unavailable score as zero.")])
heading("A score is not a screening rule")
text("A minimum numeric answer or required yes/no answer is evaluated by configured screening rules. Automatic rejection, when enabled, uses those rules. AI does not automatically reject applicants or change their stage.")
callout("Use practical verification", "Discuss portfolio contribution, experience gaps or a work sample. Check references with permission. AI-assisted resume writing alone is not proof of fraud. LinkedIn profiles are not automatically scraped; use candidate-supplied evidence.")
text("Optional manual scorecards live under Templates and the applicant's human-grade panel. They record your team's ratings and remain separate from AI scores.", "SmallA")

page("05 / SETTINGS", "Find the right control", "Use My connections for your own accounts and Team for recruiter access. Both the owner and head recruiter can check automatic email in Company.")
table([("Settings section", "Use it for"),
       ("My connections", "Your recruiting Gmail, Google Calendar and interview availability. Each account holder grants their own Google consent."),
       ("Team", "Invitations and access for recruiters. Review reminders are optional staff emails, configured separately from applicant messages."),
       ("Company", "Owner and head recruiter: automatic email status. Owner only: Drive, shared calendar, AI, message defaults and technical setup."),
       ("Help requests", "Applicant support and privacy requests submitted through the website. Verify identity before changing or deleting data."),
       ("Templates", "Optional reusable criteria for human scorecards. These are not required to use AI matching.")])
heading("Company sections")
text("<b>Automatic applicant emails:</b> check the SendGrid sender and reply-domain verification; no Gmail alias is needed.<br/><b>Owner controls - Files &amp; calendar:</b> connect company Google and save the shared applicant folder. The shared interview calendar is optional.<br/><b>AI:</b> configure the server-held OpenRouter connection.<br/><b>Messages &amp; reminders:</b> default rejection text, interview reminders and recruiter reminder controls.<br/><b>Advanced:</b> installation settings, background processing, privacy notice and access history.")
heading("Choose sensible interview hours")
text("Set your time zone, interview length, first available hour, finish time and working days. Under <b>Booking notice &amp; future dates</b>, choose advance notice and how far ahead applicants can book. Busy Calendar events block slots.")
callout("Save and verify the right service", "Each Save button applies to its section. <b>Check automatic email</b> verifies SendGrid setup; a received test confirms delivery. The owner stores keys privately in Railway and sets up the sending domain. Recruiters do not need API keys or a no-reply mailbox.")

page("06 / FILES & PRACTICE HIRE", "Download and verify", "Accepted applications save privately before background email or Drive work runs. A later posting does not overwrite earlier applicants.")
heading("Bulk download")
text("Within a job's Applications list, open <b>Download applications</b>. Choose the current filtered view, the whole posting or selected applicants. Use <b>Select all matching for download</b> when you need matching applicants from every page. The ZIP contains a readable application PDF for each applicant, original uploads and a PDF export report. Open an applicant and choose <b>Download application PDF</b> for one person. Confirm the displayed scope before downloading.")
text("Each download supports up to 10,000 applications; a ZIP's attachments are limited to 3 GB. Narrow the filters when needed. Download selections do not select everyone for rejection or other record changes.", "SmallA")
heading("The shared archive")
text("Drive folders follow <b>Recruiting > Job > Location > Posting > Applicant</b>. Each applicant folder holds readable application PDFs and original uploads. Older system JSON snapshots are converted to PDFs; originals remain intact. Temporary Google outages can delay archival while the accepted application remains saved.")
heading("Run one controlled practice hire")
table([("Test", "Confirm the actual result"),
       ("Post & apply", "Publish a TEST ONLY job. Submit one synthetic resume and required answers from a team-owned test inbox."),
       ("Save & notify", "Find the applicant, original PDF and Drive copy. Check the receipt From is no-reply@aicaseleads.com and Reply-To is no-reply@notify.aicaseleads.com, with no recruiter identity; confirm the selected recruiters receive job alerts."),
       ("Screen & rank", "Test a passing answer and a below-minimum answer. Check screening labels and, if enabled, the rejection email. Confirm a completed AI result cites the supplied evidence."),
       ("Shortlist & book", "Shortlist the test applicant. Request interview, choose the ready interviewer, send a link and book a free slot. Check time zones, Calendar event and Meet link."),
       ("Change & close", "Reschedule and cancel through the hiring flow, verifying Calendar updates. Pause or archive the test posting and keep its records for the audit.")], first=120)
text("If a step fails, record the posting, applicant, time and visible error. Inspect Delivery activity. Avoid repeated sends when delivery is uncertain. Live automatic email needs verified SendGrid setup; interviews use the selected recruiter's Google connections.", "SmallA")

def chrome(canvas, doc):
    canvas.saveState()
    canvas.setStrokeColor(GREEN)
    canvas.line(54, 49, 558, 49)
    canvas.setFont("Helvetica", 8)
    canvas.setFillColor(MUTED)
    canvas.drawString(54, 35, "AI CASE LEADS  |  jobs.aicaseleads.com")
    canvas.drawRightString(558, 35, f"Recruiter guide  |  {doc.page}")
    canvas.restoreState()

OUT.parent.mkdir(parents=True, exist_ok=True)
doc = SimpleDocTemplate(str(OUT), pagesize=(612, 792), rightMargin=54, leftMargin=54,
                        topMargin=44, bottomMargin=62, title="AI Case Leads - Recruiter Guide", author="AI Case Leads")
doc.build(story, onFirstPage=chrome, onLaterPages=chrome)
print(OUT)
