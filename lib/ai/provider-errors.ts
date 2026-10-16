import { HiringError } from '../hiring/errors';
export class AiProviderError extends HiringError {
 constructor(code:string,message:string,readonly retryAfterMs=0){super(code,502,message);}
}
/** Status and Retry-After are safe diagnostics; response bodies never escape. */
export function providerFailure(response:Response):AiProviderError {
 const raw=response.headers.get('retry-after');
 const seconds=raw===null?0:Number(raw);
 const delay=raw===null?0:Number.isFinite(seconds)?seconds*1000:Date.parse(raw)-Date.now();
 const retryAfterMs=Number.isFinite(delay)?Math.max(0,Math.min(delay,3600000)):0;
 if(response.status===429)return new AiProviderError('ai_provider_rate_limited','The AI provider is limiting requests. Reviews will retry after a pause.',Math.max(30000,retryAfterMs));
 if(response.status===401||response.status===403)return new AiProviderError('ai_provider_unauthorized','The AI provider did not accept the API key or model access. Check the AI connection.');
 if(response.status===402)return new AiProviderError('ai_provider_credit_required','The AI provider requires credit before reviews can continue.');
 return new AiProviderError('ai_provider_unavailable','AI review is unavailable. Check the OpenRouter key, balance, and model access. No review was saved.',retryAfterMs);
}

export const MATCH_PROVIDER_PAUSE_KEY='ai_match_provider_pause_v1';
export type MatchProviderPause={until:number;reason:string};
