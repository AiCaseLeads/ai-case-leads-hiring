import type { HubStore } from './store';
import type { HubMember } from './auth-core';
import { HiringError } from '../hiring/errors';
import { activeApplicationsSql } from './application-lifecycle';

export type SearchApplication={id:string;jobId:string;jobTitle:string;name:string;email:string;stage:string;qualification:string;createdAt:number};
export type SearchJob={id:string;title:string;location:string|null;status:string;archived:number};
export type WorkspaceSearch={query:string;page:number;pageSize:number;applications:{items:SearchApplication[];total:number;hasMore:boolean};jobs:{items:SearchJob[];total:number;hasMore:boolean}};
const literalLike=(value:string)=>value.replace(/[\\%_]/g,'\\$&');
// GLOB character classes fold common Spanish/Portuguese accents without fetching rows into JS.
// Every query metacharacter stays literal; the pattern is always a bound SQL value.
function namePattern(query:string){
 const accents:Record<string,string>={a:'àáâãäåāăą',c:'çćč',d:'ďđ',e:'èéêëēėęě',g:'ğ',i:'ìíîïīįı',l:'ł',n:'ñńň',o:'òóôõöøōő',r:'ř',s:'śšş',t:'ťţ',u:'ùúûüūůűų',y:'ýÿ',z:'źżž'};
 return '*'+Array.from(query.normalize('NFC')).map(char=>{
  const folded=char.normalize('NFD').replace(/\p{M}/gu,'').toLowerCase();
  if(/^[a-z]$/.test(folded)){const letters=folded+(accents[folded]||'');return '['+Array.from(new Set(letters+letters.toUpperCase())).join('')+']'}
  return char==='['?'[[]':char===']'?'[]]':char==='*'?'[*]':char==='?'?'[?]':char;
 }).join('')+'*';
}
/** Staff search returns summaries only; it never searches notes, files, credentials or Trash. */
export async function searchWorkspace(store:HubStore,member:HubMember|null,params:URLSearchParams):Promise<WorkspaceSearch>{
 if(!member||!['admin','recruiter'].includes(member.role))throw new HiringError('staff_access_required',403,'Sign in with an authorized hiring team account.');
 const query=(params.get('q')||'').trim().replace(/\s+/g,' '),rawPage=params.get('page')||'1';
 if(query.length<2||query.length>128||!/^\d+$/.test(rawPage)||Number(rawPage)<1||Number(rawPage)>1000)throw new HiringError('invalid_search',422,'Search using 2–128 characters and a valid page.');
 const page=Number(rawPage),pageSize=10,offset=(page-1)*pageSize,pattern='%'+literalLike(query)+'%',digits=query.replace(/\D/g,'');
 const phone=digits.length>=3&&/^[\d\s()+.\-]+$/.test(query);
 const phoneClause=phone?` OR EXISTS(SELECT 1 FROM json_each(CASE WHEN json_valid(a.answers_json) THEN a.answers_json ELSE '[]' END) answer WHERE json_extract(CASE WHEN answer.type='object' THEN answer.value ELSE '{}' END,'$.path') IN ('_systemfield_phone','phone','phoneNumber') AND replace(replace(replace(replace(replace(replace(CAST(json_extract(CASE WHEN answer.type='object' THEN answer.value ELSE '{}' END,'$.value') AS TEXT),' ',''),'-',''),'(',''),')',''),'+',''),'.','') LIKE ? ESCAPE '\\')`:'';
 const appWhere=`${activeApplicationsSql('a')} AND (a.name GLOB ? OR a.email LIKE ? ESCAPE '\\'${phoneClause})`,appValues=phone?[namePattern(query),pattern,'%'+digits+'%']:[namePattern(query),pattern];
 const jobWhere=`(j.title LIKE ? ESCAPE '\\' OR j.department LIKE ? ESCAPE '\\' OR coalesce(j.location,'') LIKE ? ESCAPE '\\') AND NOT EXISTS(SELECT 1 FROM hub_settings life WHERE life.key='job_lifecycle_'||j.id AND json_valid(life.value) AND json_extract(CASE WHEN json_valid(life.value) THEN life.value ELSE '{}' END,'$.state')='deleted')`;
 const [apps,appCount,jobs,jobCount]=await Promise.all([
 store.rows<SearchApplication>(`SELECT a.id,a.job_id AS jobId,a.job_title AS jobTitle,a.name,a.email,a.stage,a.qualification,a.created_at AS createdAt FROM hub_applications a WHERE ${appWhere} ORDER BY CASE WHEN lower(a.email)=lower(?) OR lower(a.name)=lower(?) THEN 0 ELSE 1 END,a.created_at DESC,a.id LIMIT ? OFFSET ?`,...appValues,query,query,pageSize,offset),
 store.stmt(`SELECT count(*) n FROM hub_applications a WHERE ${appWhere}`,...appValues).first<{n:number}>(),
 store.rows<SearchJob>(`SELECT j.id,j.title,j.location,j.status,EXISTS(SELECT 1 FROM hub_settings life WHERE life.key='job_lifecycle_'||j.id AND json_valid(life.value) AND json_extract(CASE WHEN json_valid(life.value) THEN life.value ELSE '{}' END,'$.state')='archived') AS archived FROM hub_jobs j WHERE ${jobWhere} ORDER BY j.created_at DESC,j.id LIMIT ? OFFSET ?`,pattern,pattern,pattern,pageSize,offset),
 store.stmt(`SELECT count(*) n FROM hub_jobs j WHERE ${jobWhere}`,pattern,pattern,pattern).first<{n:number}>()
 ]);
 return {query,page,pageSize,applications:{items:apps,total:appCount?.n||0,hasMore:offset+apps.length<(appCount?.n||0)},jobs:{items:jobs,total:jobCount?.n||0,hasMore:offset+jobs.length<(jobCount?.n||0)}};
}
