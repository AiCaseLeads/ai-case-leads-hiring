/** SendGrid authenticates the root domain, which accepts normal company mail. */
export const AUTOMATIC_MAIL_DOMAIN = 'aicaseleads.com';
export const AUTOMATIC_SENDER = `no-reply@${AUTOMATIC_MAIL_DOMAIN}`;
/** Reply-To alone uses Null MX: RFC 7505 domains must not appear in From. */
export const AUTOMATIC_REPLY_DOMAIN = 'notify.aicaseleads.com';
export const AUTOMATIC_REPLY_TO = `no-reply@${AUTOMATIC_REPLY_DOMAIN}`;
