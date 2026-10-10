# Connect the recruiting Google account

**For the standalone Railway edition, use [Railway setup](RAILWAY-SETUP.md).** The instructions below describe the retained Sites installation and its Apps Script scheduler.

The custom hub owns hiring records in Sites D1 and original files in private R2. Gmail, Calendar/Meet, and Drive require a real Google grant. That grant and live end-to-end tests are still pending; intake remains paused.

## Secure setup in the hub

1. Open `/team` → **Sign in to the hiring hub** → **Team & settings** as an admin. Under **Google connection setup**, copy the displayed exact HTTPS callback URI ending in `/api/google/callback`.
2. Open the team's [Google Cloud Console](https://console.cloud.google.com/). Enable Gmail, Google Calendar, and Google Drive APIs. Configure the OAuth audience as **Internal** for the team's Workspace organization when eligible, then create a **Web application** OAuth client with that exact authorized redirect URI. Google requires redirect URI matching; external/restricted-scope apps have separate consent/verification requirements. See [Google web-server OAuth](https://developers.google.com/identity/protocols/oauth2/web-server).
3. Return to **Google connection setup**. Enter the client ID and client secret in the dedicated fields and select **Save Google client configuration**. The secret field clears after successful saving. Saved client secrets and refresh tokens are encrypted server-side; status endpoints do not return them. Do not paste secrets into chat.
4. Select **Connect Google Workspace** while using the intended recruiting sender account. Grant the requested Gmail send/read, Calendar, and Drive permissions. Verify the displayed connected sender afterward. Saving a replacement OAuth client disconnects the old grant and requires reconnection.
5. Save the **Recruiting calendar ID**, **Interview time zone** (IANA name), duration, weekdays, and availability window. Save the **Recruiting Drive root folder ID**. The connected account needs Calendar event access and permission to create files under that private root; roots shared with `anyone` are rejected.
6. Use **Integration tasks** → **Process pending tasks** with authorized test records. Prove actual email delivery, replies, availability/conflicts, Meet creation, booking changes/cancellations, and correct Drive contents before relying on the integration.

The current Site's `GOOGLE_TOKEN_KEY` and `HUB_SCHEDULER_SECRET` are already set through native server configuration. Do not replace or disclose them. Replacing the encryption key makes saved sealed credentials unreadable. For separate environments, provision server-only secrets securely; `.env.example` contains placeholders only.

Gmail read permission supports exact Message-ID reconciliation and polling of known hiring threads. Full Drive scope supports the existing selected root; this build does not provide a Google Picker `drive.file` flow. The OAuth callback verifies staff-bound, expiring state and requires the requested scopes and offline refresh token. The callback sender is read from the actual Gmail profile.

## Install unattended processing

1. In **Team & settings** → **Background task processing**, select **Show scheduler configuration**. This explicitly retrieves the authenticated setup values; the scheduler secret is masked until revealed. Copy the properties only into the team's authorized Apps Script project.
2. Create a standalone [Google Apps Script](https://script.google.com/) project owned by the recruiting Workspace account. Download the scheduler source from the hub (`/workspace-scheduler.gs`) and paste it into the project. The source contains no credentials.
3. In **Project Settings** → **Script properties**, add the displayed `HIRING_SITE_URL`, `HIRING_SCHEDULER_SECRET`, and `HIRING_BATCH_LIMIT`. Use the displayed batch limit of 5 for initial validation.
4. A private Site additionally requires a verified hosting service-authentication mechanism. The script supports a `SITE_SERVICE_TOKEN` property sent in `OAI-Sites-Authorization`; obtain and validate it through the hosting platform if available. The scheduler secret alone cannot pass owner sign-in. Do not promise private unattended operation before token lifetime and renewal are established.
5. Run **installWorkspaceScheduler** manually and approve the script's Google authorization. Verify there is exactly one **runHiringQueue** trigger. Run **runHiringQueue** manually against a controlled queue, inspect task results, and check the `HIRING_LAST_SUCCESS_AT` Script property. Then observe a genuine scheduled execution.
6. Use **uninstallWorkspaceScheduler** to stop this project's hiring trigger. Keep **Process pending tasks** available as the manual fallback.

The trigger requests processing once per minute; delivery is subject to [Apps Script quotas](https://developers.google.com/apps-script/guides/services/quotas) and trigger delays, not a one-minute SLA. D1 owns leases, retry state, and failures. Stopping the scheduler does not lose tasks. The script sends no candidate data, logs no secrets, and rejects login redirects. See [installable triggers](https://developers.google.com/apps-script/guides/triggers/installable).

## Recovery and go-live

Failed tasks can be retried after fixing the cause. Uncertain Gmail sends are reconciled by exact Message-ID and never blindly resent; uncertain Calendar work uses **Reconcile Calendar** with the same event identity. Drive retries retain reserved IDs and upload state. Reconnect Google if the grant is revoked, and inspect the visible reply-polling error in settings.

Each application folder contains revision snapshots named `application-r1.json`, `application-r2.json`, and so on, plus its original files. The highest revision contains the newest archived hiring record; earlier snapshots preserve history. Separate revision identities prevent a late worker from replacing a newer snapshot. Email and Calendar results queue another snapshot, and reconciliation compares the saved application revision rather than task timestamps. Drive folder links and delivery timestamps do not themselves create new hiring revisions.

Keep the Site private, jobs draft, and intake paused until the controlled Google tests pass. Before changing to the public domain, update and verify the exact OAuth callback, emailed-link origin, and scheduler origin. Use [LAUNCH-CHECKLIST.md](LAUNCH-CHECKLIST.md) and [SUBMISSION-RECOVERY.md](SUBMISSION-RECOVERY.md).

## Optional interview reminders

The manager can enable Gmail reminders in Calendar settings. They are off by default. A subsequent confirmed booking or reschedule queues reminders 24 hours and one hour before the interview, only when those times are still in the future. Enabling the option does not backfill already confirmed bookings. Before delivery, the processor checks the current booking, revision, start time, active application, and saved setting again; stale or cancelled reminders are skipped. Live timing and delivery must still be tested after Google authorization.
