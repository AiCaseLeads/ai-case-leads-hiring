import {privateToken, sha256} from '../hiring/crypto';
import {HiringError} from '../hiring/errors';
import type {HubStore} from './store';

type BookingDraft = {
  applicationId: string;
  revision: number;
  actor: string;
  fingerprint: string;
  organizer?: string;
  existingInterviewId?: string;
  expiresAt: number;
};

const prefix = 'interview_booking_draft:';
const lifetime = 30 * 60_000;
export function draftKey(hash: string) { return prefix + hash; }

export function newBookingLink(store: HubStore) {
  if (!store.options.origin) throw new HiringError('site_unavailable',503,'The booking website has no configured address.');
  const token = privateToken();
  return {bookingToken:token, bookingUrl:new URL('/interview/'+token,store.options.origin).href};
}

export async function saveBookingDraft(store: HubStore, token:string, draft: Omit<BookingDraft,'expiresAt'>) {
  const now = Date.now();
  await store.stmt("DELETE FROM hub_settings WHERE key IN (SELECT key FROM hub_settings WHERE key GLOB 'interview_booking_draft:*' AND updated_at<=? LIMIT 100)",now-lifetime).run();
  await store.setSetting(draftKey(await sha256(token)), {...draft, expiresAt: now+lifetime});
}

export async function getBookingDraft(store: HubStore, hash:string) {
  const draft = await store.setting<BookingDraft|null>(draftKey(hash),null);
  return draft && draft.expiresAt > Date.now() ? draft : null;
}

export async function verifyBookingDraft(store:HubStore,hash:string,applicationId:string,actor:string,fingerprint:string) {
  const draft = await getBookingDraft(store,hash);
  if(!draft || draft.applicationId!==applicationId || draft.actor!==actor || draft.fingerprint!==fingerprint)
    throw new HiringError('preview_changed',409,'The booking link changed or expired. Refresh the invitation and try again.');
}
