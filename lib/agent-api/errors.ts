import {HiringError} from '../hiring/errors';
import {DeadlineError} from '../hiring/deadline';
import {jsonResponse,errorResponse} from '../hiring/http';

export const AGENT_READ_LIMITS={requests:60,windowSeconds:60,timeoutMs:20000,storageTimeoutMs:10000,concurrentFileReads:2,jsonBytes:1024*1024,bulkJsonBytes:2*1024*1024} as const;
export type AgentReadErrorDetails={limit?:Record<string,string|number>;retryAfterSeconds?:number};
/** Safe operational metadata only: never attach provider payloads or credentials. */
export class AgentReadError extends HiringError{
 readonly limit?:Record<string,string|number>;
 readonly retryAfterSeconds?:number;
 constructor(code:string,status:number,message:string,details:AgentReadErrorDetails={}){
  super(code,status,message);this.limit=details.limit;this.retryAfterSeconds=details.retryAfterSeconds;
 }
}
export function agentReadErrorResponse(error:unknown,timeoutMs:number=AGENT_READ_LIMITS.timeoutMs):Response{
 let failure:AgentReadError|undefined;
 if(error instanceof AgentReadError)failure=error;
 else if(error instanceof DeadlineError)failure=new AgentReadError(error.code==='storage_timeout'?'storage_timeout':'request_timeout',504,error.code==='storage_timeout'?'The private-file read exceeded its 10-second limit. Retry after 5 seconds.':`This read exceeded its ${timeoutMs/1000}-second limit. Retry after 5 seconds.`,{limit:{timeoutMs:error.code==='storage_timeout'?AGENT_READ_LIMITS.storageTimeoutMs:timeoutMs},retryAfterSeconds:5});
 else if(error instanceof HiringError&&error.status===429){
  const files=error.code==='file_busy',pdf=error.code==='pdf_busy';
  failure=new AgentReadError(error.code,429,error.message,{limit:files?{concurrentFileReads:AGENT_READ_LIMITS.concurrentFileReads}:pdf?{concurrentExtractions:1}:{requests:AGENT_READ_LIMITS.requests,windowSeconds:AGENT_READ_LIMITS.windowSeconds},retryAfterSeconds:files||pdf?1:60});
 }
 if(!failure)return errorResponse(error);
 const retry=failure.retryAfterSeconds===undefined?undefined:Math.max(0,Math.ceil(failure.retryAfterSeconds));
 const response=jsonResponse({error:{code:failure.code,message:failure.message,...(failure.limit?{limit:failure.limit}:{}),...(retry!==undefined?{retryAfterSeconds:retry}:{})}},failure.status);
 if(retry!==undefined)response.headers.set('Retry-After',String(retry));
 return response;
}
