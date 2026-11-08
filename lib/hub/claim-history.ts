import type {ApplicationField,FieldSubmission} from '../hiring/types';
import type {HubStore} from './store';
import type {ApplicationDetail,Stage} from './types';
import {activeApplicationsSql} from './application-lifecycle';

type Snapshot=Pick<ApplicationDetail,'fields'|'answers'|'createdAt'>;
export function experienceDifferences(current:Snapshot, other:Snapshot){
 const byTitle=(snap:Snapshot)=>new Map(snap.fields.filter(f=>f.type==='Number' && typeof f.title === 'string' && /\byears?\b/i.test(f.title) && !/currency|salary|pay|budget/i.test(f.numberFormat+' '+f.title)).map(f=>[f.title.trim().toLowerCase(),snap.answers.find(a=>a.path===f.path)?.value]));
 const previous=byTitle(other),differences=[];
 for(const [question,value] of byTitle(current)){
  const prior=previous.get(question);
  const numeric=(v:unknown)=>typeof v==='number' || (typeof v==='string' && /^\d+(\.\d+)?$/.test(v.trim()));
  if(!numeric(value)||!numeric(prior))continue;
  const elapsed=Math.abs(current.createdAt-other.createdAt)/(365.25*86400000);
  if(Math.abs(Number(value)-Number(prior))>elapsed+1)differences.push({question,current:Number(value),other:Number(prior)});
 }
 return differences;
}
function readSnapshot<T>(json: string): T[] {
 try {
  const value: unknown = JSON.parse(json);
  return Array.isArray(value) ? value.filter(item => item && typeof item.path === 'string') : [];
 } catch {
  return [];
 }
}

export async function claimHistory(store:HubStore,current:ApplicationDetail){
 const rows=await store.rows<{id:string;jobId:string;jobTitle:string;stage:Stage;createdAt:number;answers:string;fields:string}>(`SELECT id,job_id AS jobId,job_title AS jobTitle,stage,created_at AS createdAt,answers_json AS answers,fields_json AS fields FROM hub_applications a WHERE email=? AND id<>? AND ${activeApplicationsSql('a')} ORDER BY created_at DESC,id`,current.email,current.id);
 return rows.map(({fields,answers,...item})=>({...item,differences:experienceDifferences(current,{createdAt:item.createdAt,fields:readSnapshot<ApplicationField>(fields),answers:readSnapshot<FieldSubmission>(answers)})}));
}
