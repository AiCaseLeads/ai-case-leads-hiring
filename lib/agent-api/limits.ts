import type {HubStore} from '../hub/store';
import {sha256} from '../hiring/crypto';
import {AgentReadError,AGENT_READ_LIMITS} from './errors';

/** Shared database budget across clients/processes, charged after authentication. */
export async function takeAgentReadBudget(store:HubStore,agentId:string,now=Date.now()){
 const windowMs=AGENT_READ_LIMITS.windowSeconds*1000,minute=Math.floor(now/windowMs);
 // Reuse the table's ten-minute bucket convention so existing retention cleanup
 // remains correct; the minute slot in the private key enforces a 60-second limit.
 const window=Math.floor(now/600000),key=await sha256('agent-read:'+agentId+':minute:'+(minute%10));
 const accepted=await store.stmt('INSERT INTO hiring_rate_limits(key_hash,window,attempts) VALUES(?,?,1) ON CONFLICT(key_hash,window) DO UPDATE SET attempts=attempts+1 WHERE attempts<? RETURNING attempts',key,window,AGENT_READ_LIMITS.requests).first<{attempts:number}>();
 if(!accepted){
  const retryAfterSeconds=Math.max(1,Math.ceil(((minute+1)*windowMs-now)/1000));
  throw new AgentReadError('agent_read_rate_limited',429,`This connection reached its limit of ${AGENT_READ_LIMITS.requests} read requests per ${AGENT_READ_LIMITS.windowSeconds} seconds. Retry after ${retryAfterSeconds} seconds.`,{limit:{requests:AGENT_READ_LIMITS.requests,windowSeconds:AGENT_READ_LIMITS.windowSeconds},retryAfterSeconds});
 }
}
