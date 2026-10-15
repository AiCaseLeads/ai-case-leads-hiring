import type { Review } from './review';
export type AiMatchStatus = 'disabled'|'setup_required'|'pending'|'ready'|'needs_review'|'failed'|'stale';
export type AiMatchSummary = {status:AiMatchStatus;score:number|null;version:number;updatedAt:number|null};
export type AiMatchDetail = AiMatchSummary & {criteria:Review['criteria'];checks:Review['checks'];sourceWarnings:string[];model:string;error?:string};
