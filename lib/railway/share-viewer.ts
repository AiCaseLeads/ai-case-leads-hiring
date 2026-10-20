import {sha256} from '../hiring/crypto';
export const shareViewerCookie=(secure:boolean)=>secure?'__Host-aicl_share_viewer':'aicl_share_viewer';
export async function shareViewerIdentity(headers:Headers,db:D1Database,now=Date.now()):Promise<{email:string}|null>{
 const cookies=(headers.get('cookie')||'').split(';').map(v=>v.trim()).filter(v=>v.startsWith(shareViewerCookie(true)+'=')||v.startsWith(shareViewerCookie(false)+'='));
 if(cookies.length!==1)return null;
 const token=cookies[0].slice(cookies[0].indexOf('=')+1);if(!/^[a-f0-9]{64}$/.test(token))return null;
 const row=await db.prepare('SELECT value FROM hub_settings WHERE key=?').bind('share_viewer:'+await sha256(token)).first<{value:string}>();
 if(!row)return null;try{const value=JSON.parse(row.value);return value.expiresAt>now&&typeof value.email==='string'?{email:value.email}:null;}catch{return null;}
}
