import { HiringError } from "../hiring/errors";
import type { ApplicationFilters, HubStore } from "./store";
import type { HubMember } from "./auth-core";

type Selection = {actor:string;ids:string[];expiresAt:number};
const prefix = 'application_selection:';

export async function createApplicationSelection(store: HubStore, filters: ApplicationFilters, member: HubMember, ids?: string[]) {
  const {items: matches} = await store.selectionSnapshot(filters);
  const requested = ids && new Set(ids);
  const items = requested ? matches.filter(row=>requested.has(row.id)) : matches;
  if (requested && (items.length !== requested.size || requested.size !== ids!.length))
    throw new HiringError('selection_changed', 409, 'Some selected applications have changed. Refresh and select them again.');
  const now = Date.now(), selectionId = crypto.randomUUID();
  await store.db.batch([
    store.stmt("DELETE FROM hub_settings WHERE key IN (SELECT key FROM hub_settings WHERE key LIKE 'application_selection:%' AND updated_at<? ORDER BY updated_at LIMIT 100)",now-30*60000),
    store.settingStatement(prefix+selectionId,{actor:member.email.toLowerCase(),ids:items.map(row=>row.id),expiresAt:now+30*60000}),
  ]);
  return {items,selectionId};
}

export async function getApplicationSelection(store: HubStore, selectionId: string, member: HubMember) {
  const record = /^[a-f0-9-]{36}$/.test(selectionId) && await store.setting<Selection|null>(prefix+selectionId,null);
  if (!record || record.expiresAt <= Date.now() || record.actor !== member.email.toLowerCase())
    throw new HiringError('selection_unavailable',409,'The selection expired. Select the applications again.');
  return record.ids;
}
