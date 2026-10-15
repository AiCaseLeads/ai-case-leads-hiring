/** Definite pre-send setup failures. These must never auto-release historical mail. */
export const MAIL_SETUP_ERRORS = [
  'candidate_mail_account_not_configured',
  'candidate_mail_account_connection_required',
  'gmail_sender_alias_not_verified',
  'google_oauth_reconnect_required',
  'google_required_permissions_missing',
  'recruiter_reply_contact_required',
  'candidate_mail_exposes_staff_address',
] as const;
export function isMailSetupError(code:string){return (MAIL_SETUP_ERRORS as readonly string[]).includes(code);}
