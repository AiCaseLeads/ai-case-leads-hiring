import type { HubStore } from '../hub/store';
import type { HubJob } from '../hub/types';
import { descriptionText } from './matching';
/** Run in the same batch as the optimistic job update. Applicant answers/fields are
 * submission snapshots: rearranging the live form does not change old AI sources.
 * Only completed evidence is reused; changed title/description or opt-in invalidates it. */
export function unchangedJobMatchStatements(store:HubStore,previous:HubJob,next:Pick<HubJob,'title'|'descriptionHtml'|'aiMatchEnabled'>):D1PreparedStatement[]{
 if(!previous.aiMatchEnabled||!next.aiMatchEnabled||previous.title.trim()!==next.title.trim()||descriptionText(previous.descriptionHtml)!==descriptionText(next.descriptionHtml))return [];
 const version=previous.formVersion+1,guard="EXISTS(SELECT 1 FROM hub_jobs j WHERE j.id=? AND j.form_version=? AND j.ai_match_enabled=1)";
 return [
  store.stmt(`INSERT INTO hub_ai_criteria(job_id,form_version,status,criteria_json,attempts,run_after,error,updated_at) SELECT job_id,?,'ready',criteria_json,0,0,NULL,updated_at FROM hub_ai_criteria WHERE job_id=? AND form_version=? AND status='ready' AND changes()=1 AND ${guard} ON CONFLICT(job_id,form_version) DO NOTHING`,version,previous.id,previous.formVersion,previous.id,version),
  store.stmt(`INSERT INTO hub_ai_matches(application_id,job_id,form_version,status,score,review_json,warnings_json,attempts,run_after,error,updated_at) SELECT m.application_id,m.job_id,?,m.status,m.score,m.review_json,m.warnings_json,0,0,NULL,m.updated_at FROM hub_ai_matches m WHERE m.job_id=? AND m.form_version=? AND m.status IN ('ready','needs_review') AND changes()=1 AND EXISTS(SELECT 1 FROM hub_ai_criteria c WHERE c.job_id=m.job_id AND c.form_version=? AND c.status='ready') AND ${guard} ON CONFLICT(application_id,form_version) DO NOTHING`,version,previous.id,previous.formVersion,version,previous.id,version),
 ];
}
