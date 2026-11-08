# Owner interview booking and Gmail replies

The Send booking link failure was caused by explicit `sales@aicaseleads.com` exclusions in job reply routing, personal Gmail setup, worker transport and Gmail sender verification. A connected Calendar did not supply the separate Gmail grant.

Owners now use the same personal recruiting-email authorization as active managers and recruiters. The acting sender uses their own verified Gmail account and is included in CC. For interview invitations, Reply-To follows the selected personal interviewer; company-calendar invitations fall back to the acting sender. Renewals retain their original interviewer. Other manual emails retain the acting sender in Reply-To. Automatic receipts/rejections retain SendGrid/no-reply routing with no staff copy. Company Drive/Calendar credentials are never substituted for personal Gmail consent.

Explicit membership revocation overrides ADMIN_EMAILS consistently with production authentication. Missing/revoked mail grants still block sending with setup guidance. An approved invitation retains its reviewed From/To/CC/Reply-To; changed routing requires fresh review. Recovery excludes such mismatches, and Activity shows approved/actual delivery routing rather than an unsent recomputation. Existing held messages are not automatically released.

## Verification

- Full application suite: 724 passed, 3 native OCR tests skipped before the separate operator helper was added.
- Operator self-test helper: 3 additional tests passed; deterministic reconciliation, identity restrictions and uncertain-send handling covered.
- MCP compatibility: 3 passed; runtime suite: 20 passed with one optional built-server test skipped; AWS deployment tests: 5 passed.
- Chrome UI: owner composer at 390/1280 px, disconnected owner guidance, personal email setup and reply-contact selection passed (8 focused checks).
- Typecheck, production build, changed-source ESLint and diff checks passed. Source-wide lint excluding generated vendor assets has 9 existing warnings and no errors.
- A synthetic full send-path test exercises owner preflight → preview → queue → real Gmail client with a mocked provider → valid private booking link → MIME CC/Reply-To → recorded Activity → repeat processing without another send. No real applicant is contacted.
- The expanded built-server/load smoke is not claimed passed. Its 20 public browser checks pass after updating stale sign-in and required-LinkedIn fixtures; a later hiring-request wizard step timed out. That wizard's source is unchanged in this fix and needs separate investigation.
- Claude Code and independent peer reviews were completed; their revocation and envelope-consistency findings were fixed and regression-tested.

Live OAuth, provider acceptance and inbox receipt require independent verification after deployment. No applicant invitation is sent merely to test the interface.

## Operator self-test

A separate Node process inside the deployed container can call `sendOwnerRecruitingTest(email,testId)` from `dist/railway/worker.mjs`. It is not exposed through HTTP/MCP or scheduled automatically. It validates the selected address is an active configured owner, uses only that owner's explicit personal Gmail grant, fixes the message contents and recipient, and returns message identifiers without credentials. Run it only for an explicitly approved self-test.

Use the same strict test ID to reconcile a previously accepted send. An uncertain result is not permission to retry blindly. This diagnostic contains no applicant data or booking link and does not alter applicant records. Its self-copy recipient may be deduplicated because it is already in To; applicant invitation MIME is separately tested with distinct candidate and sender addresses.

## Interview routing and stale-page follow-up

A full CandidateDetail Chrome test reproduced a second Send failure: the page held an old applicant revision while Preview approved the latest revision. The preview now returns its approved application revision, and Send uses that same revision. A change after Preview still blocks the send, clears approval, preserves the email/note draft and requires another preview.

The selected interviewer is carried through readiness, preview fingerprint, queued metadata, worker revalidation, recovery and Activity. The acting sender remains the Gmail transport and CC recipient. Deactivating the interviewer holds the queued message; reactivation alone never silently sends it.

Combined release checks: 773 application tests passed, 3 native OCR tests skipped; 4 composer Chrome checks passed, including phone/desktop and another interviewer. The application suite includes two physical full-CandidateDetail tests through the actual invitation routes using a synthetic store/provider. AWS verifier checks passed (12 Python, 4 SQLite tests), as did typecheck, build, changed-source lint and diff checks. No real applicant was contacted.
