import type { AutomaticMailTransport } from '../../lib/email/service';
import type { MailInput } from '../../lib/google/gmail';
/** Only queue tests use this mock; provider protocol tests exercise the real client. */
export function automaticFixture(send: (mail: MailInput) => Promise<Record<string, unknown>> = async () => ({ id: 'fixture-provider', provider: 'sendgrid', accepted: true }), reconcile: AutomaticMailTransport['reconcileMail'] = async () => null): AutomaticMailTransport {
  return { fingerprint: 'fixture-key', verify: async () => {}, sendMail: send, reconcileMail: reconcile };
}
