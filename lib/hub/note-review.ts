import type {HubStore} from './store';
import {sha256} from '../hiring/crypto';
import {HiringError} from '../hiring/errors';
export type NotesReview={version:string;hasUnread:boolean;count:number;reviewedAt:number|null};
const key=(id:string,email:string)=>`notes_review:${id}:${email.trim().toLowerCase()}`;
export async function notesReviews(store:HubStore,ids:string[],email:string):Promise<Map<string,NotesReview>>{
 const result=new Map<string,NotesReview>();
 for(let offset=0;offset<ids.length;offset+=100){
  const chunk=ids.slice(offset,offset+100),placeholders=chunk.map(()=>'?').join(',');
  const notes=await store.rows<{id:string;application_id:string;text:string}>(`SELECT id,application_id,text FROM hub_history WHERE application_id IN (${placeholders}) AND type='note' ORDER BY created_at,id`,...chunk);
  const saved=await store.rows<{key:string;value:string}>(`SELECT key,value FROM hub_settings WHERE key IN (${placeholders})`,...chunk.map(id=>key(id,email)));
  const markers=new Map(saved.map(row=>{try{return [row.key,JSON.parse(row.value)] as const;}catch{return [row.key,null] as const;}}));
  for(const id of chunk){const group=notes.filter(note=>note.application_id===id),version=await sha256(JSON.stringify(group.map(note=>[note.id,note.text]))),marker=markers.get(key(id,email)),current=marker?.version===version;result.set(id,{version,count:group.length,hasUnread:group.length>0&&!current,reviewedAt:current&&typeof marker.reviewedAt==='number'?marker.reviewedAt:null});}
 }
 return result;
}
export async function markNotesReviewed(store:HubStore,id:string,email:string,expected:string){
 const app=await store.applicationRow(id),review=(await notesReviews(store,[id],email)).get(id)!;
 if(review.version!==expected)throw new HiringError('notes_changed',409,'The notes changed. Read the latest notes before marking them reviewed.');
 const notes=await store.rows<{id:string;text:string}>("SELECT id,text FROM hub_history WHERE application_id=? AND type='note' ORDER BY created_at,id",id),snapshot=JSON.stringify(notes.map(note=>[note.id,note.text]));
 if(await sha256(snapshot)!==expected)throw new HiringError('notes_changed',409,'The notes changed. Read the latest notes before marking them reviewed.');
 const now=Date.now();
 const saved=await store.stmt('INSERT INTO hub_settings(key,value,updated_at) SELECT ?,?,? WHERE EXISTS(SELECT 1 FROM hub_applications WHERE id=? AND revision=?) AND (SELECT json_group_array(json_array(id,text)) FROM (SELECT id,text FROM hub_history WHERE application_id=? AND type=\'note\' ORDER BY created_at,id))=? ON CONFLICT(key) DO UPDATE SET value=excluded.value,updated_at=excluded.updated_at RETURNING key',key(id,email),JSON.stringify({version:expected,reviewedAt:now}),now,id,app.revision,id,snapshot).first();
 if(!saved)throw new HiringError('notes_changed',409,'The application changed. Refresh before marking notes reviewed.');
 return {...review,hasUnread:false,reviewedAt:now};
}
