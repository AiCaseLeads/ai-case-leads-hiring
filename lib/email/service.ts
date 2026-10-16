import { SendGridMail } from './sendgrid';
import { AUTOMATIC_SENDER } from './contracts';
import { verifyNoReplyDomain } from './dns';
import { readSendgridEvidence } from './sendgrid-events';
import { sha256 } from '../hiring/crypto';
import type { HubStore } from '../hub/store';
import type { MailInput } from '../google/gmail';

export interface AutomaticMailTransport {
  fingerprint: string;
  verify: () => Promise<unknown>;
  setDeadline?: (deadline?: number) => void;
  sendMail: (mail: MailInput) => Promise<Record<string, unknown>>;
  reconcileMail: (messageId: string, to: string, sentAt?: number) => Promise<Record<string, unknown> | null>;
}
export type AutomaticMailResolver = () => Promise<AutomaticMailTransport>;
export async function automaticMailTransport(store?: HubStore): Promise<AutomaticMailTransport> {
  const key = process.env.SENDGRID_API_KEY?.trim();
  if (!key) throw { code: 'transactional_mail_key_required', uncertain: false };
  const client = new SendGridMail({ apiKey: key });
  let deadlineAt:number|undefined;
  return {
    fingerprint: await sha256(key),
    verify: async () => { await client.verifySender(); await verifyNoReplyDomain(fetch,Date.now(),deadlineAt); },
    setDeadline: deadline => {deadlineAt=deadline;client.setDeadline(deadline);},
    sendMail: async mail => ({...await client.send(mail)}),
    reconcileMail: async (messageId, to, sentAt) => {
      const evidence=store?await readSendgridEvidence(store,messageId,to,sentAt):null;
      if(evidence)return evidence;
      const found=await client.reconcile(messageId,to,{days:Math.min(30,Math.max(2,Math.ceil((Date.now()-(sentAt||Date.now()))/86400_000)+1))});return found?{...found}:null;
    },
  };
}
export function automaticMailDailyLimit(): number {
  const value = Number(process.env.AUTOMATIC_MAIL_DAILY_LIMIT || 300);
  return Number.isSafeInteger(value) && value > 0 && value <= 100_000 ? value : 300;
}
/** Reserve before every provider POST. Conservatively count failed and uncertain attempts too. */
export async function reserveAutomaticMail(store: HubStore, now = Date.now(), limit = automaticMailDailyLimit()) {
  const day = new Date(now).toISOString().slice(0, 10), key = `automatic_mail_budget:${day}`;
  const reserved = await store.stmt("INSERT INTO hub_settings(key,value,updated_at) VALUES(?,'1',?) ON CONFLICT(key) DO UPDATE SET value=CAST(CAST(hub_settings.value AS INTEGER)+1 AS TEXT),updated_at=excluded.updated_at WHERE CAST(hub_settings.value AS INTEGER)<? RETURNING key", key, now, limit).first();
  if (!reserved) throw { code: 'transactional_mail_daily_limit', uncertain: false, retryAt: Date.parse(day + 'T00:00:00Z') + 86400_000 + 60_000 };
}
export function isAutomaticMailDeferred(code: string) {
  return ['transactional_mail_daily_limit', 'transactional_mail_rate_limited', 'transactional_mail_quota_exhausted','transactional_mail_dns_check_failed'].includes(code);
}
export async function automaticMailStatus(resolve: AutomaticMailResolver = automaticMailTransport) {
  const base = { provider: 'sendgrid' as const, sender: AUTOMATIC_SENDER, configured: !!process.env.SENDGRID_API_KEY?.trim(), dailyLimit: automaticMailDailyLimit(), setupUrl: 'https://app.sendgrid.com' };
  try {
    const transport = await resolve(); transport.setDeadline?.(Date.now() + 20_000); await transport.verify();
    return { ...base, configured: true, ready: true, error: null, checkedAt: Date.now() };
  } catch (error) {
    const code = error && typeof error === 'object' && 'code' in error ? error.code : '';
    return { ...base, ready: false, error: typeof code === 'string' && /^transactional_mail_[a-z_]{1,80}$/.test(code) ? code : 'transactional_mail_check_failed', checkedAt: Date.now() };
  }
}
