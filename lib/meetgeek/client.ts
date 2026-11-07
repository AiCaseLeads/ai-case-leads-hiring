/** MeetGeek API contract: https://docs.meetgeek.ai/api/getting-started/introduction */
import {HiringError} from '../hiring/errors';
export const REGIONS={eu:'https://api-eu.meetgeek.ai',us:'https://api-us.meetgeek.ai'} as const;
export type Meeting={meeting_id:string;title?:string;participant_emails?:string[];event_id?:string;join_link?:string;timestamp_start_utc?:string;timestamp_end_utc?:string};
export function meetingId(value:unknown):string {if(typeof value!=='string'||! /^[A-Za-z0-9_-]{8,100}$/.test(value))throw new HiringError('invalid_meeting',422,'Enter a valid MeetGeek meeting ID.');return value;}
export class MeetGeekClient {
 constructor(private key:string,private region:keyof typeof REGIONS='eu',private fetcher:typeof fetch=fetch){}
 async request<T>(path:string,method='GET'):Promise<T>{
  const response=await this.fetcher(REGIONS[this.region]+path,{method,headers:{Authorization:`Bearer ${this.key}`,Accept:'application/json'},redirect:'error',signal:AbortSignal.timeout(15000)});
  if(!response.ok)throw new HiringError('meetgeek_unavailable',response.status===429?429:502,response.status===401||response.status===403?'MeetGeek access was denied. Check the API key, region and team sharing.':'MeetGeek could not complete this request. Try again shortly.');
  const reader=response.body?.getReader();if(!reader)throw new Error('Empty MeetGeek response');let size=0;const chunks:Uint8Array[]=[];try{while(true){const part=await reader.read();if(part.done)break;size+=part.value.length;if(size>2*1024*1024)throw new HiringError('meetgeek_response_too_large',502,'MeetGeek response exceeded the limit.');chunks.push(part.value);}}finally{await reader.cancel();reader.releaseLock();}const bytes=new Uint8Array(size);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.length;}return JSON.parse(new TextDecoder().decode(bytes)) as T;
 }
 list(cursor=''){return this.request<{meetings:Meeting[];pagination?:{next_cursor?:string}}>('/v1/meetings?limit=5'+(cursor?'&cursor='+encodeURIComponent(cursor):''));}
 meeting(id:string){return this.request<Meeting>('/v1/meetings/'+meetingId(id));}
 summary(id:string){return this.request<{summary?:string}>('/v1/meetings/'+meetingId(id)+'/summary');}
 async transcript(id:string){let cursor='',text='';for(let page=0;page<5;page++){const data=await this.request<{sentences?:{speaker?:string;transcript?:string;timestamp?:string}[];pagination?:{next_cursor?:string}}>('/v1/meetings/'+meetingId(id)+'/transcript?limit=100'+(cursor?'&cursor='+encodeURIComponent(cursor):''));text+=(data.sentences||[]).map(s=>`${s.timestamp||''} ${s.speaker||'Speaker'}: ${s.transcript||''}`).join('\n')+'\n';if(text.length>200000){text=text.slice(0,200000)+'\n[Transcript truncated]';break;}cursor=data.pagination?.next_cursor||'';if(!cursor)break;}return text;}
 async recording(id:string){const data=await this.request<{download_link?:string}>('/v1/meetings/'+meetingId(id)+'/download','POST');let u:URL;try{u=new URL(data.download_link||'');}catch{throw new HiringError('recording_unavailable',502,'MeetGeek has not provided a recording link.');}if(u.protocol!=='https:'||u.username||u.password||!/(^|\.)meetgeek\.ai$/.test(u.hostname))throw new HiringError('recording_unavailable',502,'MeetGeek returned an unsupported recording host.');return u.toString();}
}
export async function verifySignature(secret:string,body:Uint8Array,signature:string|null){if(!signature||! /^[a-f0-9]{64}$/i.test(signature))return false;const key=await crypto.subtle.importKey('raw',new TextEncoder().encode(secret),{name:'HMAC',hash:'SHA-256'},false,['verify']);const bytes=Uint8Array.from(signature.match(/../g)!,b=>parseInt(b,16));return crypto.subtle.verify('HMAC',key,bytes.buffer as ArrayBuffer,new Uint8Array(body).buffer as ArrayBuffer);}
