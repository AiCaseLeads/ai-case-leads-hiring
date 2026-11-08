import { HiringError } from '../hiring/errors';
import { activeApplicationsSql } from '../hub/application-lifecycle';
import type { HubStore } from '../hub/store';
import { appCheckJoinsSql, appCheckStatusSql, responseStates, type ResponseState } from './report-status';

export type ResponseListItem = {id:string; name:string; jobTitle:string; createdAt:number; status:ResponseState};
const pageSize=20;
export async function listResponseChecks(store:HubStore, params:URLSearchParams) {
  const status=params.get('status') || '';
  const matches=params.get("matches") || "";
  const page=Number(params.get('page') || 1);
  if ((matches && matches!=="shared") || !Number.isSafeInteger(page) || page<1 || page>100000 || (status && !Object.hasOwn(responseStates,status))) {
    throw new HiringError('invalid_response_filters',422,'Choose a valid page and processing status.');
  }
  const scoped=`FROM hub_applications a ${appCheckJoinsSql} WHERE ${activeApplicationsSql('a')}`;
  let filter=status ? ' AND '+appCheckStatusSql+'=?':'';
  if(matches) filter+=` AND EXISTS (
    SELECT 1 FROM hub_response_passages local
    JOIN hub_response_passages peer ON peer.passage_hash=local.passage_hash AND peer.application_id<>local.application_id
    JOIN hub_applications other ON other.id=peer.application_id
    WHERE local.application_id=a.id AND (trim(a.email)='' OR lower(trim(other.email))<>lower(trim(a.email)))
    AND ${activeApplicationsSql('other')})`;
  const values=status?[status]:[];
  const total=await store.stmt('SELECT COUNT(*) AS n '+scoped+filter,...values).first<{n:number}>();
  const items=await store.rows<ResponseListItem>(`SELECT a.id,a.name,a.job_title AS jobTitle,
    a.created_at AS createdAt,${appCheckStatusSql} AS status ${scoped}${filter}
    ORDER BY a.created_at DESC,a.id DESC LIMIT ? OFFSET ?`,...values,pageSize,(page-1)*pageSize);
  return {items,total:total?.n || 0,page,pageSize};
}

export async function readResponseEntry(store:HubStore, id:string) {
  const row=await store.stmt(`SELECT response_entry_json FROM hub_applications a WHERE id=? AND ${activeApplicationsSql('a')}`,id).first<{response_entry_json:string|null}>();
  if(!row) throw new HiringError('application_not_found',404,'This application is unavailable.');
  if(!row.response_entry_json) return null;
  const {parseResponseEntry}=await import('../hiring/response-entry');
  try {return parseResponseEntry(JSON.parse(row.response_entry_json));} catch {return null;}
}
