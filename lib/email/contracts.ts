/** SendGrid authenticates the root domain. This sender has no staff alias or mailbox. */
export const AUTOMATIC_MAIL_DOMAIN = 'aicaseleads.com';
export const AUTOMATIC_SENDER = `no-reply-recruiting@${AUTOMATIC_MAIL_DOMAIN}`;
/** Reply-To alone uses Null MX; RFC 7505 recommends against Null MX From domains. */
export const AUTOMATIC_REPLY_DOMAIN = 'notify.aicaseleads.com';
export const AUTOMATIC_REPLY_TO = `no-reply@${AUTOMATIC_REPLY_DOMAIN}`;
