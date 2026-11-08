/** Definite pre-send setup failures. These must never auto-release historical mail. */
export const MAIL_SETUP_ERRORS = [
  'candidate_mail_account_not_configured',
  'candidate_mail_account_connection_required',
  'gmail_sender_alias_not_verified',
  'google_oauth_reconnect_required',
  'google_required_permissions_missing',
  'recruiter_reply_contact_required',
  'interview_sender_changed',
  'candidate_mail_exposes_staff_address',
  'transactional_mail_key_required',
  'transactional_mail_domain_not_verified',
  'transactional_mail_reply_domain_not_verified',
  'transactional_mail_sender_not_verified',
  'transactional_mail_account_not_enabled',
  'transactional_mail_auth_required',
  'transactional_mail_invalid_key',
] as const;
export function isMailSetupError(code:string){return (MAIL_SETUP_ERRORS as readonly string[]).includes(code);}

/** Explicit automatic identities outrank routing fields left in older queued payloads. */
export function candidateTaskMailMode(taskId: string, applicationId: string, payload: Record<string, unknown>): unknown {
  if (taskId === `gmail:${applicationId}:confirmation` || taskId === `gmail:${applicationId}:rejection` || taskId.startsWith(`gmail:${applicationId}:rejection:`)) return undefined;
  return payload.mailMode || (/:(manual|assessment|interview):/.test(taskId) ? "recruiter" : undefined);
}

export function isRejectionTask(taskId:string,applicationId:string):boolean {
 return taskId===`gmail:${applicationId}:rejection` || taskId.startsWith(`gmail:${applicationId}:rejection:`);
}

export function isInterviewInvitationTask(taskId:string,applicationId:string):boolean {
 const prefix=`gmail:${applicationId}:interview:`;
 return taskId.startsWith(prefix)&&/^[^:]+:invitation:[0-9]+$/.test(taskId.slice(prefix.length));
}
