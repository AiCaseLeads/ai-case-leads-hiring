# Hiring email text

The custom hub sends through the connected recruiting Gmail account. These are reviewable drafts, not proof of delivery. Automatic rejection starts off. Test one email per decision and verify the actual sender before enabling live communications.

## Rejection body

Paste an approved body into **Roles & forms** → **Edit role & form** → rejection template. The implemented substitutions are `{{name}}` and `{{jobTitle}}`; other placeholder syntax is not supported.

```text
Hi {{name}},

Thank you for applying for {{jobTitle}} at AI Case Leads. We appreciate the time you took to apply. We will not be moving forward with your application for this role.

AI Case Leads Hiring Team
```

The system supplies the rejection subject. Keep decision reasons in the private hiring record unless the approved message intentionally includes them. A repeated decision must not produce another rejection email.

## Application acknowledgement

The current automated acknowledgement uses this text, populated by the server; it is not editable from this worksheet:

```text
Subject: Application received: [job title]

Hi [applicant name],

We received your application for [job title] at AI Case Leads. Our hiring team will review it and contact you about next steps.

AI Case Leads Hiring Team
```

## Assessment and interview invitations

Recruiters initiate these from **Applications** → candidate → **Next action**. The server creates and emails a private expiring link; do not invent a link or copy another candidate's link. Save the approved assessment prompt in the role first, and configure Calendar/availability before initiating an interview.

A successful invitation request means work was queued. Confirm sent status in communication history and the connected mailbox. A calendar/Meet booking is confirmed only after Calendar processing succeeds.

## Optional manual follow-up

Use the candidate's **Email** action after replacing every bracketed value. Manual messages do not expand template variables.

```text
Subject: Your AI Case Leads interview

Hi [applicant name],

Your interview for [job title] is scheduled for [date, time, and time zone]. Please use the meeting details in your calendar invitation. Use your original personal booking link if you need to reschedule or cancel.

AI Case Leads Hiring Team
```

This is a manual follow-up draft. Optional automatic Gmail reminders are controlled by **Team & settings** → **Send interview reminders through Gmail** and default off. They are scheduled 24 hours and 1 hour before confirmed future bookings. Verify actual delivery and suppression after rescheduling/cancellation during the controlled live test before enabling them for applicants. Calendar invitation/update notifications require their own live check.
