import { AUTOMATIC_REPLY_DOMAIN } from './contracts';
let verifiedUntil = 0;
const temporary=()=>({code:'transactional_mail_dns_check_failed',uncertain:false,retryAt:Date.now()+60_000});
/** A Null MX rejects replies on the isolated notify domain. Transient DNS outages retry safely. */
export async function verifyNoReplyDomain(fetcher: typeof fetch = fetch, now = Date.now(), deadline?:number) {
  if (fetcher === fetch && verifiedUntil > now) return;
  const timeout=Math.min(8_000,deadline===undefined?8_000:deadline-now);
  if(timeout<=0)throw temporary();
  let data:{Status?:number;Answer?:Array<{name?:string;type?:number;data?:string}>};
  try {
    const url=`https://cloudflare-dns.com/dns-query?name=${AUTOMATIC_REPLY_DOMAIN}&type=MX`;
    const response=await fetcher(url,{headers:{Accept:'application/dns-json'},redirect:'error',signal:AbortSignal.timeout(Math.max(1,Math.floor(timeout)))});
    if(!response.ok)throw new Error('dns_check_failed');
    data=await response.json() as typeof data;
    if(typeof data?.Status!=='number'||![0,3].includes(data.Status)|| (data.Answer!==undefined&&(!Array.isArray(data.Answer)||data.Answer.some(record=>!record||typeof record!=='object'))))throw new Error('dns_check_failed');
  }catch{throw temporary();}
  const mx=(data.Answer||[]).filter(record=>record.type===15);
  if(data.Status!==0||mx.length!==1||mx[0].name?.replace(/\.$/,'').toLowerCase()!==AUTOMATIC_REPLY_DOMAIN||mx[0].data?.trim()!=='0 .')throw {code:'transactional_mail_reply_domain_not_verified',uncertain:false};
  if(fetcher===fetch)verifiedUntil=now+5*60_000;
}
