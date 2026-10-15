# Applications by job and bulk downloads

Open **Applications**, then choose a job. Search by job title or location, or select open, closed, or draft postings. Counts show applicants and those in Application Review. Closed postings retain their records and downloads.

Within a posting, apply search/stage/qualification filters. **Top 10 AI matches** keeps those filters and shows up to ten active applicants with completed scores for the current job version. Rejected, withdrawn, hired, pending, unreadable and outdated reviews are excluded from this shortcut. **Show all applicants** removes the ten-person limit. **Clear filters** keeps the selected job. **All jobs** returns to the chooser.

## Download scope

- **Current view:** every matching applicant across pages, or the top-ten shortlist when active.
- **All applicants for this job:** ignores the current filters, including the top-ten shortcut.
- **Selected applicants:** only the checked applicants in the current view. Selecting a checkbox chooses this scope automatically. Navigation or refreshed records can clear the selection; check the displayed count before downloading.

**Download spreadsheet (CSV)** includes names, email, stage, qualification, current AI score/status, reviewer grade, Drive links, readable question answers, and machine-readable answers/questions. Spreadsheet formula characters are neutralized.

**Download application files (ZIP)** includes that spreadsheet, a separate application JSON file for each applicant, original uploaded attachments, and a manifest. Applicant and file IDs distinguish duplicate names. Read `manifest.json` for unavailable originals; a missing file does not erase its application data. Exports do not include full private communication/interview history.

Downloads require a current staff login and stay private. A preflight validates the scope and size, then the browser download manager streams the file. “Download started” means the browser has begun; confirm completion in its download list. No Google connection is needed to download originals stored on Railway.

Downloads are limited to 10,000 matching applications, 1,000 explicitly selected IDs, and 3 GB of uploaded files per ZIP. The server rejects larger requests instead of silently truncating them. Narrow filters or select fewer applicants when a limit is reached. Individual files are processed sequentially rather than collecting all PDFs in memory.
