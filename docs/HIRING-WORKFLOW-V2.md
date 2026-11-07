# Approved hiring workflow

User decisions captured November 7, 2026:
- All authorized recruiters can review all roles and applicants. Ownership is manual assignment or claim.
- Recruiters start with assigned unreviewed applicants; Collins and Maria start with founder-review handoffs.
- Preserve existing stages, with readable labels: New, Shortlisted/recruiter screening, Assessment, First interview, Awaiting founder review, Second interview, Offer, Hired, Rejected, Withdrawn.
- Only owner and Maria may approve second interview or offer.
- Handoff requires recommendation, notes, summary, recording, expected salary, availability and concerns. Explicit none is valid for concerns.
- Notes become reviewed only by explicit Mark reviewed; edits create a new unread version.
- Role-wide interview list; schedule through existing Google Calendar/Meet connection.
- MeetGeek automatically matches recording/transcript by candidate email and calendar event, with manual attachment and ambiguity handling.
- Email notifications for founder handoff; delivery state is visible. Never equate queued with delivered.
- Per-job automation controls for authorized recruiters; AI draft/summarize/rank assist, human decisions remain explicit. No-response automatic rejection stays off.
- AI job import accepts text/uploads, previews readable JD/questions/rules, supports country variants and Codex/Claude via authenticated scoped API/MCP.
- Existing shortlist, reject, bulk rejection, share, original files and public links stay available.
- Existing spreadsheets are not the workflow or an import prerequisite.

Release gate: backend authorization/readiness/filter/recording/token tests; UI mobile and desktop smoke; full typecheck/tests/build; independent review; AWS exact commit deployment and authenticated live read verification. Provider connections requiring new secrets or OAuth grants must show setup required until connected and tested.

## Release verification
- Full existing and workflow tests: 660 passed, 3 intentionally skipped (before final UI guard refinements).
- Railway/AWS runtime and migration tests: 21 passed; AWS deploy script tests: 5 passed.
- Local synthetic authenticated UI: complete recruiter handoff → Awaiting Founder Review → explicit Mark reviewed → Second Round Interview; no provider mail worker enabled.
- MeetGeek requires an owner to enter the regional API key and configure the signed webhook. Do not represent API-key presence as a verified connection.
- Direct recording uploads are private, limited to 100 MB; use a provider link for larger calls. Caddy has an exact POST upload exception; other paths remain at 12 MB. The Node runtime enforces the smaller route-specific caps.
- No seven-day no-response rejection is enabled.
