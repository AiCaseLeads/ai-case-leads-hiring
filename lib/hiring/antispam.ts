import { HiringError } from './errors';
import { sha256 } from './crypto';
export type SpamConfig = { siteKey?: string; secret?: string; hostname?: string; required?: boolean };
export function spamConfig(): SpamConfig {
  return { siteKey: process.env.TURNSTILE_SITE_KEY, secret: process.env.TURNSTILE_SECRET_KEY, hostname: process.env.PUBLIC_ORIGIN ? new URL(process.env.PUBLIC_ORIGIN).hostname : undefined, required: process.env.TURNSTILE_REQUIRED === 'true' };
}
export function spamStatus(config = spamConfig()) {
  const required = !!(config.required || config.siteKey || config.secret);
  return { required, configured: !!(config.siteKey && config.secret), siteKey: config.siteKey || null };
}
function checkConfig(config: SpamConfig) {
  const status = spamStatus(config);
  if (status.required && !status.configured) throw new HiringError('verification_unavailable',503,'Application verification is temporarily unavailable. Your answers are still here; please try again later.');
  return status.required;
}
async function signature(value: string, secret: string) {
  const key = await crypto.subtle.importKey('raw',new TextEncoder().encode(secret),{name:'HMAC',hash:'SHA-256'},false,['sign']);
  return Array.from(new Uint8Array(await crypto.subtle.sign('HMAC',key,new TextEncoder().encode(value))),b=>b.toString(16).padStart(2,'0')).join('');
}
export async function verifyChallenge(token: unknown, session: string, submissionKey: string, jobId: string, hostname: string, config = spamConfig(), fetcher: typeof fetch = fetch) {
  if (!checkConfig(config)) return { grant: '', expiresAt: 0 };
  if (typeof token !== 'string' || !token || token.length > 2048) throw new HiringError('verification_required',403,'Complete the security check before submitting.');
  let result: { success?: boolean; hostname?: string; action?: string; challenge_ts?: string };
  try {
    const response = await fetcher('https://challenges.cloudflare.com/turnstile/v0/siteverify',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({secret:config.secret,response:token}),signal:AbortSignal.timeout(10000)});
    if (!response.ok) throw new Error('unavailable');
    result = await response.json();
  } catch { throw new HiringError('verification_unavailable',503,'The security check could not finish. Please try again.'); }
  const age = Date.now() - Date.parse(result.challenge_ts || '');
  if (!result.success || result.hostname !== (config.hostname || hostname) || result.action !== 'application' || !Number.isFinite(age) || age < -60000 || age > 300000) throw new HiringError('verification_required',403,'The security check expired or failed. Please complete it again.');
  const expiresAt = Date.now()+30*60*1000;
  const payload = `${expiresAt}.${await sha256(`${session}:${submissionKey}:${jobId}`)}`;
  return { grant: `${payload}.${await signature(payload,config.secret!)}`, expiresAt };
}
export async function requireGrant(grant: string | null, session: string, submissionKey: string, jobId: string, config = spamConfig()) {
  if (!checkConfig(config)) return;
  const parts = (grant || '').split('.');
  const payload = parts.slice(0,2).join('.');
  const expected = await signature(payload,config.secret!);
  let difference = expected.length ^ (parts[2] || '').length;
  for(let i=0;i<expected.length;i++) difference |= expected.charCodeAt(i) ^ ((parts[2] || '').charCodeAt(i) || 0);
  if(parts.length !== 3 || difference || Number(parts[0]) < Date.now() || Number(parts[0]) > Date.now()+1800000 || parts[1] !== await sha256(`${session}:${submissionKey}:${jobId}`)) throw new HiringError('verification_required',403,'Complete the security check again. Your answers are still here.');
}
