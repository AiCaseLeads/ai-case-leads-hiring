import {z} from 'zod';
import {HiringError} from '../hiring/errors';
import {sha256} from '../hiring/crypto';
import {activeApplicationsSql} from './application-lifecycle';
import type {HubMember} from './auth-core';
import type {HubStore} from './store';

export type ReviewSummary = {
  id:string;listId:string;name:string;requester:string;reviewer:string;prompt:string;
  createdAt:number;total:number;completed:number;
};
export type ReviewItem = {
  applicationId:string;name:string;jobTitle:string;stage:string;feedback:string;reviewedAt:number|null;
};
export type ReviewInbox = {items:ReviewSummary[];total:number;page:number};
export type ListReviewDetail = {summary:ReviewSummary;items:ReviewItem[];canRespond:boolean};
const summaryColumns=`r.id,r.collection_id AS listId,c.name,r.requester,r.reviewer,r.prompt,r.created_at AS createdAt,
  COUNT(*) AS total,COUNT(i.reviewed_at) AS completed`;
const joined = `FROM hub_collection_reviews r JOIN hub_collections c ON c.id=r.collection_id AND c.visibility='team'
  JOIN hub_collection_review_items i ON i.review_id=r.id JOIN hub_applications a ON a.id=i.application_id`;
const missing = () => new HiringError('review_request_unavailable',404,'This review request is unavailable.');
const invalid = () => new HiringError('invalid_review_request',422,'Choose a team list, reviewer, and up to 100 applications to review.');
const requestInput=z.object({
  action:z.literal('request'),requestId:z.string().uuid(),listId:z.string().uuid(),revision:z.number().int().positive(),
  reviewer:z.string().trim().toLowerCase().email(),prompt:z.string().trim().max(1000),
  ids:z.array(z.string().min(1).max(200)).min(1).max(100).optional(),
}).strict();
const replyInput=z.object({
  action:z.literal('review'),requestId:z.string().uuid(),applicationId:z.string().min(1).max(200),
  feedback:z.string().trim().max(4000),
}).strict();
const commandInput=z.discriminatedUnion('action',[requestInput,replyInput]);

export async function listReviewers(store:HubStore,member:HubMember) {
  const owners=(process.env.ADMIN_EMAILS||'').split(',').map(v=>v.trim().toLowerCase()).filter(v=>z.string().email().safeParse(v).success);
  const team=(await store.members()).filter(p=>p.active).map(p=>p.email.toLowerCase());
  return [...new Set([...owners,...team,...(member.isOwner?[member.email.toLowerCase()]:[])])].sort();
}
export async function reviewsInbox(store:HubStore,member:HubMember,params:URLSearchParams):Promise<ReviewInbox> {
  const sent=params.get('box')==='sent', done=params.get('status')==='completed';
  const page=Number(params.get('page')||1);
  if (!Number.isSafeInteger(page)||page<1||page>10000) throw invalid();
  const column=sent?'r.requester':'r.reviewer';
  const tail=`${joined} WHERE ${column}=? AND ${activeApplicationsSql('a')} GROUP BY r.id
    HAVING COUNT(i.reviewed_at)${done?'=':'<'}COUNT(*)`;
  const email=member.email.toLowerCase();
  const total=await store.stmt(`SELECT COUNT(*) AS n FROM (SELECT r.id ${tail})`,email).first<{n:number}>();
  const items=await store.rows<ReviewSummary>(`SELECT ${summaryColumns} ${tail} ORDER BY r.created_at DESC,r.id LIMIT 10 OFFSET ?`,email,(page-1)*10);
  return {items,total:total?.n||0,page};
}

export async function listReviewDetail(store:HubStore,member:HubMember,id:string):Promise<ListReviewDetail> {
  const actor=member.email.toLowerCase();
  const access=`r.id=? AND (r.requester=? OR r.reviewer=? OR c.owner=?) AND ${activeApplicationsSql('a')}`;
  const args=[id,actor,actor,actor];
  const summary=await store.stmt(`SELECT ${summaryColumns} ${joined} WHERE ${access} GROUP BY r.id`,...args).first<ReviewSummary>();
  if(!summary) throw missing();
  const items=await store.rows<ReviewItem>(`SELECT a.id AS applicationId,a.name,a.job_title AS jobTitle,a.stage,i.feedback,i.reviewed_at AS reviewedAt
    ${joined} WHERE ${access} ORDER BY i.position,i.application_id`,...args);
  return {summary,items,canRespond:summary.reviewer===actor};
}

export async function changeListReview(store:HubStore,member:HubMember,input:unknown) {
  const parsed=commandInput.safeParse(input);
  if(!parsed.success) throw invalid();
  const cmd=parsed.data,actor=member.email.toLowerCase(),now=Date.now();
  if(cmd.action==='review') {
    const result=await store.stmt(`UPDATE hub_collection_review_items SET feedback=?,reviewed_at=?
      WHERE review_id=? AND application_id=? AND reviewed_at IS NULL AND EXISTS (
        SELECT 1 FROM hub_collection_reviews r JOIN hub_collections c ON c.id=r.collection_id
        JOIN hub_applications a ON a.id=hub_collection_review_items.application_id
        WHERE r.id=hub_collection_review_items.review_id AND r.reviewer=? AND c.visibility='team' AND ${activeApplicationsSql('a')})`,
      cmd.feedback,now,cmd.requestId,cmd.applicationId,actor).run();
    if(!result.meta.changes) {
      const existing=await listReviewDetail(store,member,cmd.requestId);
      if(!existing.canRespond) throw new HiringError('reviewer_required',403,'Only the assigned reviewer can submit this feedback.');
      const item=existing.items.find(i=>i.applicationId===cmd.applicationId);
      if(!item) throw missing();
      if(!item.reviewedAt || item.feedback!==cmd.feedback) throw new HiringError('review_already_recorded',409,'Feedback was already recorded. Refresh to see it.');
    }
    return {id:cmd.requestId};
  }
  if(cmd.ids && new Set(cmd.ids).size!==cmd.ids.length) throw invalid();
  if(!(await listReviewers(store,member)).includes(cmd.reviewer)) throw invalid();
  const fingerprint=await sha256(JSON.stringify([actor,cmd.listId,cmd.revision,cmd.reviewer,cmd.prompt,cmd.ids??null]));
  const eligible=`FROM hub_collection_members m JOIN hub_applications a ON a.id=m.application_id
    WHERE m.collection_id=? AND ${activeApplicationsSql('a')}${cmd.ids?' AND a.id IN (SELECT value FROM json_each(?))':''}`;
  const selection: string[]=[cmd.listId,...(cmd.ids?[JSON.stringify(cmd.ids)]:[])];
  const results=await store.db.batch([
    store.stmt(`INSERT INTO hub_collection_reviews(id,collection_id,requester,reviewer,prompt,fingerprint,created_at)
      SELECT ?,?,?,?,?,?,? WHERE EXISTS (SELECT 1 FROM hub_collections WHERE id=? AND kind='list' AND visibility='team' AND revision=?)
      AND (SELECT COUNT(*) ${eligible}) BETWEEN ? AND ? ON CONFLICT(id) DO NOTHING`,
      cmd.requestId,cmd.listId,actor,cmd.reviewer,cmd.prompt,fingerprint,now,cmd.listId,cmd.revision,...selection,cmd.ids?.length||1,cmd.ids?.length||100),
    store.stmt(`INSERT INTO hub_collection_review_items(review_id,application_id,position)
      SELECT ?,m.application_id,m.position ${eligible} AND changes()=1`,cmd.requestId,...selection),
  ]);
  if(!results[0].meta.changes) {
    const previous=await store.stmt(`SELECT r.fingerprint FROM hub_collection_reviews r JOIN hub_collections c ON c.id=r.collection_id
      WHERE r.id=? AND r.requester=? AND c.visibility='team'`,cmd.requestId,actor).first<{fingerprint:string}>();
    if(!previous || previous.fingerprint!==fingerprint)
      throw new HiringError('review_selection_changed',409,'Refresh the team list and choose between 1 and 100 current applications.');
  }
  return {id:cmd.requestId};
}
