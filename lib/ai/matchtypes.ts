import type { Review } from './review';
export type AiMatchStatus = 'disabled'|'setup_required'|'pending'|'running'|'preparing'|'ready'|'needs_review'|'failed'|'stale';
export type AiMatchSummary = {status:AiMatchStatus;score:number|null;version:number;updatedAt:number|null;retryPending?:boolean};
export type AiMatchDetail = AiMatchSummary & {criteria:Review['criteria'];checks:Review['checks'];sourceWarnings:string[];model:string;error?:string;progress?:{state:string;providerPauseReason?:string|null;attempts:number;readyAhead:number|null;nextRetryAt:number|null;hourlyLimit:number;capacityRemaining:number;capacityResetsAt:number;updatedAt:number|null}};
