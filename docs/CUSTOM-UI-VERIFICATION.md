# Custom hiring UI verification

Verified locally on October 9, 2026 using isolated headless Chrome against the integrated local server. The browser used the normal local Sites sign-in flow. Staff and candidate API transport was intercepted with explicitly synthetic responses; no fixture action wrote hiring records or contacted Gmail, Calendar, Meet, Drive, or an external hiring provider.

Nine grouped checks passed with zero page errors:

1. Authenticated overview and the actual draft-template creation request.
2. Editable role and application question save, including multiword choices, with automatic rejection disabled.
3. Candidate details and a recorded internal-note action.
4. Source-quality report columns render returned qualification/interview/hire counts and the qualification percentage with its source application denominator.
5. Secure Google client save clears the secret; authorization errors appear; scheduler secrets are masked until explicitly revealed; settings preserve the owner and do not reactivate inactive members. Interview reminders initialize off, and opting in sends the explicit enabled value in the settings save.
6. Failed integration work has a safe retry action; uncertain Calendar work has a functioning reconciliation request; uncertain Gmail delivery has no resend control.
7. The mobile overview stays within the viewport and all workspace navigation remains available.
8. Assessment confirmation follows an accepted POST and removes the repeat-submit action.
9. Interview choices use actual returned slots grouped by date; a pending booking remains pending and never becomes a confirmation in the UI.

The final fixture rerun passed all nine groups with zero page errors and 11 intercepted write requests. The fixture script is in the task’s work directory (`custom-hub-ui-check.mjs`), with synthetic mobile screenshots there. This fixture is evidence for controls, payloads, error feedback, and responsive behavior. It does not prove live Google authorization, delivery, reminder timing, Calendar availability, Drive archival, scheduled processing, production permissions, or public-domain routing.

Root’s separate native browser checks exercise actual local D1 role creation/editing and settings. Account-level Google authorization and end-to-end launch checks remain separate gates.
