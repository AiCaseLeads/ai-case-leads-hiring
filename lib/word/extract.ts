import {spawn} from 'node:child_process';
import path from 'node:path';
import {HiringError} from '../hiring/errors';
export const WORD_MIMES=['application/msword','application/vnd.openxmlformats-officedocument.wordprocessingml.document'];
const MAX_BYTES=10*1024*1024,MAX_TEXT_BYTES=200000;
let backgroundActive=0,interactiveActive=0;
/** A bounded local process keeps malformed Word parsing off the request event loop. */
export async function extractWordText(bytes:Uint8Array,mime:string,timeoutMs=8000,background=false):Promise<{text:string;truncated:boolean}> {
  if(bytes.length>MAX_BYTES||!WORD_MIMES.includes(mime))throw new HiringError('preview_unavailable',415,'This Word file cannot be previewed. Download the original instead.');
  if(backgroundActive+interactiveActive>=3 || (background ? backgroundActive>=2 : interactiveActive>=2))throw new HiringError('word_preview_busy',503,'Documents are being opened. Please retry in a moment.');
  if(background)backgroundActive++;else interactiveActive++;
  try{return await new Promise((resolve,reject)=>{
    const cwd=process.cwd(),worker=path.resolve(cwd,'scripts/word-text-worker.mjs'),guard=path.resolve(cwd,'lib/hiring/document-structure.ts');
    const child=spawn(process.execPath,['--max-old-space-size=96','--permission',`--allow-fs-read=${path.resolve(cwd,'node_modules')}`,`--allow-fs-read=${worker}`,`--allow-fs-read=${guard}`,`--allow-fs-read=${path.resolve(cwd,'package.json')}`,worker,mime],{stdio:['pipe','pipe','ignore'],env:{NODE_ENV:'production'},windowsHide:true});
    let output='',outputBytes=0,settled=false;
    const finish=(error?:HiringError,result?:{text:string;truncated:boolean})=>{if(settled)return;settled=true;clearTimeout(timer);child.kill('SIGKILL');if(error)reject(error);else resolve(result!);};
    const unavailable=()=>new HiringError('preview_unavailable',415,'This Word file may be damaged, password-protected or contain no readable text. Download the original instead.');
    const timer=setTimeout(()=>finish(new HiringError('word_preview_timeout',503,'Opening this Word document took too long. Download the original or try again.')),Math.min(8000,Math.max(1,timeoutMs)));
    child.on('error',()=>finish(new HiringError('word_preview_unavailable',503,'Word preview is temporarily unavailable. Download the original instead.')));
    child.stdin.on('error',()=>undefined);
    child.stdout.setEncoding('utf8');
    child.stdout.on('data',(chunk:string)=>{outputBytes+=Buffer.byteLength(chunk);if(outputBytes>MAX_TEXT_BYTES*6+1024)return finish(unavailable());output+=chunk;});
    child.on('close',code=>{
      if(settled)return;
      if(code!==0)return finish(unavailable());
      try{const parsed=JSON.parse(output);if(parsed.status!=='ready'||typeof parsed.text!=='string'||!parsed.text.trim()||Buffer.byteLength(parsed.text)>MAX_TEXT_BYTES||typeof parsed.truncated!=='boolean')return finish(unavailable());finish(undefined,{text:parsed.text,truncated:parsed.truncated});}catch{finish(unavailable());}
    });
    child.stdin.end(bytes);
  });}finally{if(background)backgroundActive--;else interactiveActive--;}
}
