# Recruiter calendars

Staff connect their own primary Google Calendar under Settings → My calendar. The connected Google account must exactly match their signed-in staff email. This consent requests Calendar events, free/busy, and verified account email only; it does not replace the company Gmail/Drive account. Recruiters then save their time zone, days, hours and interview length. The owner must have configured the existing Google web OAuth client first. No new redirect URL is required.

- `GET /api/personal-calendar`: current user's status/availability and active staff calendar readiness. No tokens, client secrets or grant fingerprints are returned.
- `PUT /api/personal-calendar`: `{availability:{timeZone,weekdays,startHour,endHour,durationMinutes,minimumNoticeHours?,horizonDays?}}`; edits only the signed-in user's availability.
- `POST /api/personal-calendar/connect`: returns `{data:{url}}` for consent using the existing `/api/google/callback`.
- Staff interview action accepts optional `interviewerEmail`. A supplied interviewer must be active, connected, and have saved availability. Omission preserves legacy shared-calendar behavior.

Each new personal interview atomically records its organizer, calendar email and availability. Renewals, candidate booking/rescheduling, event creation and cancellation retain that identity. To change the organizer, cancel the original interview and issue another invitation. Reconnecting the same account repairs its credential without redirecting existing events to another calendar. A broken personal connection fails visibly; it never uses the sales calendar as a fallback. Existing shared-calendar invitations keep their legacy behavior.

Personal refresh tokens are encrypted with the existing server token key and kept in `hub_settings` under a per-email key. Client changes invalidate grant readiness by revision; provider operations also check the configuration fingerprint. OAuth state is single use, expires after ten minutes, is tied to staff user ID, and uses PKCE. Company email and Drive settings are never written by the personal flow. Company sender availability is still needed to send candidate invitation/reminder emails.

Availability is copied when issuing an invitation. Changes apply to new invitations; existing invitations keep the schedule advertised when issued. Calendar free/busy is always checked live before offering/booking slots, and the existing durable event IDs and local reservation locks prevent duplicate events and booking races.

Google references: [OAuth scopes](https://developers.google.com/identity/protocols/oauth2/scopes), [verified primary email profile](https://developers.google.com/resources/api-libraries/documentation/oauth2/v2/python/latest/oauth2_v2.userinfo.html).
