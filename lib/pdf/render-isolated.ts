import { spawn } from "node:child_process";
import path from "node:path";
const MAX_BYTES=16*1024*1024, MAX_PENDING=8;
// A process-wide gate also covers independently bundled HTTP and background callers.
const KEY=Symbol.for("hiring.pdf.render.queue");
type Gate={tail:Promise<void>;pending:number};
const shared=globalThis as typeof globalThis & {[KEY]?:Gate};
function gate():Gate{return shared[KEY]??=( {tail:Promise.resolve(),pending:0} );}
export async function renderPdfIsolated(request:unknown, options:{timeoutMs?:number;queueTimeoutMs?:number;workerPath?:string}={}):Promise<Uint8Array>{
  const state=gate();
  if(state.pending>=MAX_PENDING)throw new Error("application_pdf_busy");
  const input=JSON.stringify(request);
  if(Buffer.byteLength(input)>MAX_BYTES)throw new Error("application_pdf_too_large");
  const queueTimeout=Math.min(60_000,Math.max(1,options.queueTimeoutMs??60_000));
  const deadline=Date.now()+queueTimeout;
  state.pending++;
  const previous=state.tail;let release!:()=>void;
  state.tail=new Promise<void>(resolve=>{release=resolve;});
  let acquired=false,queueTimer:ReturnType<typeof setTimeout>|undefined;
  try{
    await Promise.race([previous,new Promise<never>((_,reject)=>{queueTimer=setTimeout(()=>reject(new Error("application_pdf_timeout")),queueTimeout);})]);
    clearTimeout(queueTimer);acquired=true;
    if(Date.now()>=deadline)throw new Error("application_pdf_timeout");
    return await new Promise<Uint8Array>((resolve,reject)=>{
      const production=process.env.NODE_ENV==='production';
      const entry=options.workerPath||path.resolve(process.cwd(),production?'dist/pdf-render/render-worker.mjs':'lib/pdf/render-worker.ts');
      const args=['--max-old-space-size=256',...(!production&&!options.workerPath?['--import','tsx']:[]),entry];
      const child=spawn(process.execPath,args,{stdio:['pipe','pipe','ignore'],windowsHide:true,env:{NODE_ENV:production?'production':'test'}});
      let size=0,reason:string|undefined;const chunks:Buffer[]=[];
      const fail=(code:string)=>{reason??=code;child.kill('SIGKILL');};
      const timer=setTimeout(()=>fail('application_pdf_timeout'),Math.max(1,Math.min(options.timeoutMs??30_000,deadline-Date.now())));
      child.on('error',()=>{reason??='application_pdf_unavailable';});
      child.stdin.on('error',()=>{fail('application_pdf_unavailable');});
      child.stdout.on('data',(chunk:Buffer)=>{size+=chunk.length;if(size>MAX_BYTES)fail('application_pdf_too_large');else chunks.push(chunk);});
      // Keep the queue slot until the child actually exits, including after timeout.
      child.on('close',code=>{
        clearTimeout(timer);
        if(reason||code!==0){reject(new Error(reason||'application_pdf_failed'));return;}
        const bytes=Buffer.concat(chunks);
        if(bytes.subarray(0,5).toString()!=='%PDF-'){reject(new Error('application_pdf_invalid'));return;}
        resolve(new Uint8Array(bytes));
      });
      child.stdin.end(input);
    });
  }finally{clearTimeout(queueTimer);if(acquired){state.pending--;release();}else{void previous.then(()=>{state.pending--;release();});}}
}
