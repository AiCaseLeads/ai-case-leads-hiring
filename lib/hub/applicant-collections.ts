import { z } from 'zod';
import { getApplicationSelection } from './application-selections';
import { HiringError } from '../hiring/errors';
import { activeApplicationsSql } from './application-lifecycle';
import type { HubMember } from './auth-core';
import type { HubStore } from './store';

const id = z.string().uuid();
const name = z.string().trim().min(1).max(80);
const visibility = z.enum(['personal', 'team']);
const query = z.string().max(2500);
const ids = z.array(z.string().min(1).max(200)).min(1).max(100).refine(items => new Set(items).size === items.length);
const base = { id, revision: z.number().int().positive() };
const mutation = z.discriminatedUnion('action', [
  z.object({ action: z.literal('create'), creationId:id.optional(), kind: z.enum(['list','view']), name, visibility, query: query.optional(), ids: ids.optional(), selectionId:id.optional() }).strict(),
  z.object({ action: z.literal('edit'), ...base, name, visibility, query: query.optional() }).strict(),
  z.object({ action: z.literal('delete'), ...base }).strict(),
  z.object({ action: z.literal('add'), ...base, ids:ids.optional(), selectionId:id.optional() }).strict(),
  z.object({ action: z.literal('prioritize'), ...base, ids:ids.optional(), selectionId:id.optional() }).strict(),
  z.object({ action: z.literal('remove'), ...base, ids:ids.optional(), selectionId:id.optional() }).strict(),
]);

type CollectionRow = {
  id: string; kind: 'view' | 'list'; name: string; visibility: 'personal' | 'team';
  owner: string; query: string; revision: number; updatedAt: number; size: number;
};
export type ApplicantCollection = CollectionRow & { owned: boolean };
export type ComparedApplication = {
  id:string; name:string; jobTitle:string; stage:string; qualification:string;
  owner:string|null; recommendation:string|null; salary:string|null; availability:string|null; concerns:string|null;
};

const visible = "(c.owner=? OR c.visibility='team')";
const notFound = () => new HiringError('collection_not_found',404,'This list or view is unavailable.');
const invalid = () => new HiringError('invalid_collection',422,'Check the name, selected applications and sharing settings.');
const conflict = () => new HiringError('collection_changed',409,'This collection changed. Refresh it and try again.');
const filterKeys = new Set([
  'q','stage','excludeStage','assignee','qualification','grade','sort','top','active','duplicate','trash',
  'appliedFrom','appliedTo','timeZone','interviewProgress','jobId','jobGroupId','openPostings','country','listId','handoffReturned','columns',
]);

export async function applicantCollections(store:HubStore,member:HubMember):Promise<ApplicantCollection[]> {
  const email = member.email.toLowerCase();
  const rows = await store.rows<CollectionRow>(`SELECT c.id,c.kind,c.name,c.visibility,c.owner,c.query,c.revision,
    c.updated_at AS updatedAt,(SELECT COUNT(*) FROM hub_collection_members m JOIN hub_applications a ON a.id=m.application_id
    WHERE m.collection_id=c.id AND ${activeApplicationsSql('a')}) AS size
    FROM hub_collections c WHERE ${visible} ORDER BY c.kind,c.name COLLATE NOCASE,c.id`,email);
  return rows.map(row => ({...row,owned:row.owner===email}));
}

async function checkedQuery(store:HubStore,member:HubMember,value:string,scope:'personal'|'team',validate:(params:URLSearchParams)=>void) {
  const params = new URLSearchParams(value);
  for (const key of params.keys()) {
    if (!filterKeys.has(key) || params.getAll(key).length !== 1) throw invalid();
  }
  validate(params);
  const listId = params.get('listId');
  if (listId) {
    const list = await store.stmt(`SELECT c.visibility FROM hub_collections c WHERE c.id=? AND c.kind='list' AND ${visible}`,listId,member.email.toLowerCase()).first<{visibility:string}>();
    if (!list) throw notFound();
    if (scope==='team' && list.visibility !== 'team')
      throw new HiringError('private_list_in_team_view',422,'Share the underlying list with the team before sharing this view.');
  }
  params.sort();
  return params.toString();
}

export async function changeApplicantCollection(store:HubStore,member:HubMember,input:unknown,validate:(params:URLSearchParams)=>void) {
  const parsed = mutation.safeParse(input);
  if (!parsed.success) throw invalid();
  const command = parsed.data, email=member.email.toLowerCase(), nonce=crypto.randomUUID(), now=Date.now();
  const existing = command.action==='create' ? null : await store.stmt(
    `SELECT c.kind,c.owner,c.visibility,c.query,c.revision FROM hub_collections c WHERE c.id=? AND ${visible}`,
    command.id,email).first<Pick<CollectionRow,'kind'|'owner'|'visibility'|'query'|'revision'>>();
  if (command.action!=='create') {
    if (!existing) throw notFound();
    if ((command.action==='edit' || command.action==='delete') && existing.owner!==email)
      throw new HiringError('collection_owner_required',403,'Only the creator can change the name, sharing or saved filters, or delete the collection.');
    if (existing.revision!==command.revision) throw conflict();
  }
  const collectionId = command.action==='create' ? command.creationId || crypto.randomUUID() : command.id;
  const kind = command.action==='create' ? command.kind : existing!.kind;
  const membership = command.action==='add' || command.action==='prioritize' || command.action==='remove' || (command.action==='create' && !!command.ids);
  if (membership && kind!=='list') throw invalid();
  const explicitIds = 'ids' in command ? command.ids : undefined;
  const selectionId = 'selectionId' in command ? command.selectionId : undefined;
  if (selectionId && (explicitIds || kind!=='list')) throw invalid();
  const members = selectionId ? await getApplicationSelection(store,selectionId,member) : explicitIds || [];
  if (['add','remove','prioritize'].includes(command.action) && members.length===0) throw invalid();
  const memberJSON = JSON.stringify(members);
  // Verify *every* selected application during the same transaction that changes membership.
  const completeSet = command.action==='prioritize'
    ? `(SELECT COUNT(*) FROM hub_collection_members m JOIN hub_applications a ON a.id=m.application_id
         WHERE m.collection_id=? AND m.application_id IN (SELECT value FROM json_each(?)) AND ${activeApplicationsSql('a')})=?`
    : command.action==='remove'  || !members.length ? '1' :
    `(SELECT COUNT(*) FROM hub_applications a WHERE a.id IN (SELECT value FROM json_each(?)) AND ${activeApplicationsSql('a')})=?`;
  const checkArgs = completeSet==='1' ? [] : [...(command.action==='prioritize'?[collectionId]:[]),memberJSON,members.length];
  const writes:D1PreparedStatement[] = [];
  if (command.action==='create' || command.action==='edit') {
    if (kind==='list' && command.query!==undefined) throw invalid();
    if (kind==='view' && command.action === 'create' && command.query===undefined) throw invalid();
    const storedQuery = kind==='view' ? await checkedQuery(store,member,command.query ?? existing?.query ?? '',command.visibility,validate) : '';
    if (command.action==='create') {
      writes.push(store.stmt(`INSERT INTO hub_collections(id,kind,name,owner,visibility,query,revision,last_mutation,updated_at)
        SELECT ?,?,?,?,?,?,1,?,? WHERE ${completeSet} ON CONFLICT(id) DO NOTHING`,collectionId,kind,command.name,email,command.visibility,storedQuery,nonce,now,...checkArgs));
    } else {
      writes.push(store.stmt(`UPDATE hub_collections SET name=?,visibility=?,query=?,revision=revision+1,last_mutation=?,updated_at=?
        WHERE id=? AND owner=? AND revision=?`,command.name,command.visibility,storedQuery,nonce,now,collectionId,email,command.revision));
    }
  } else if (command.action==='delete') {
    writes.push(store.stmt('DELETE FROM hub_collections WHERE id=? AND owner=? AND revision=?',collectionId,email,command.revision));
  } else {
    writes.push(store.stmt(`UPDATE hub_collections SET revision=revision+1,last_mutation=?,updated_at=?
      WHERE id=? AND kind='list' AND (owner=? OR visibility='team') AND revision=? AND ${completeSet}`,
      nonce,now,collectionId,email,command.revision,...checkArgs));
  }
  // The nonce ensures a losing revision check cannot edit another writer's members.
  if (members.length) {
    const won = "EXISTS (SELECT 1 FROM hub_collections WHERE id=? AND last_mutation=?)";
    if (command.action==='remove') {
      writes.push(store.stmt(`DELETE FROM hub_collection_members WHERE collection_id=? AND application_id IN (SELECT value FROM json_each(?)) AND ${won}`,collectionId,memberJSON,collectionId,nonce));
    } else {
      const bounds=await store.stmt("SELECT COALESCE(MIN(position),0) AS first,COALESCE(MAX(position),0) AS last FROM hub_collection_members WHERE collection_id=?",collectionId).first<{first:number;last:number}>();
      if (command.action==='prioritize') {
        const first=(bounds?.first || 0)-members.length;
        writes.push(store.stmt(`UPDATE hub_collection_members SET position=?+(SELECT CAST(pick.key AS INTEGER) FROM json_each(?) pick WHERE pick.value=application_id)
          WHERE collection_id=? AND application_id IN (SELECT value FROM json_each(?)) AND ${won}`,first,memberJSON,collectionId,memberJSON,collectionId,nonce));
      } else {
        writes.push(store.stmt(`INSERT INTO hub_collection_members(collection_id,application_id,added_by,added_at,position)
          SELECT ?,value,?,?,?+CAST(key AS INTEGER) FROM json_each(?) WHERE ${won}
          ON CONFLICT(collection_id,application_id) DO NOTHING`,collectionId,email,now,(bounds?.last || 0)+1,memberJSON,collectionId,nonce));
      }
    }
  }
  const result = await store.db.batch(writes);
  if (result[0].meta.changes!==1) {
    if (command.action==='create') {
      const prior=await store.stmt("SELECT id FROM hub_collections WHERE id=? AND owner=? AND kind=? AND name=? AND visibility=?",
        collectionId,email,kind,command.name,command.visibility).first();
      if (prior) return {id:collectionId};
      throw new HiringError('selection_changed',409,'This collection or its selected applications changed. Refresh before trying again.');
    }
    throw conflict();
  }
  return {id:collectionId};
}

export async function compareListApplications(store:HubStore,member:HubMember,listId:string,selected:string[]):Promise<ComparedApplication[]> {
  if (!id.safeParse(listId).success || selected.length<2 || selected.length>5 || new Set(selected).size!==selected.length) throw invalid();
  const rows = await store.rows<ComparedApplication>(`SELECT a.id,a.name,a.job_title AS jobTitle,a.stage,a.qualification,a.assignee AS owner,
    r.recommendation,r.salary_expectation AS salary,r.availability,r.concerns FROM json_each(?) pick
    JOIN hub_collection_members m ON m.application_id=pick.value JOIN hub_collections c ON c.id=m.collection_id
    JOIN hub_applications a ON a.id=m.application_id LEFT JOIN hub_recruiter_reviews r ON r.application_id=a.id
    WHERE c.id=? AND c.kind='list' AND ${visible} AND ${activeApplicationsSql('a')} ORDER BY CAST(pick.key AS INTEGER)`,
    JSON.stringify(selected),listId,member.email.toLowerCase());
  if(rows.length!==selected.length) throw notFound();
  return rows;
}
