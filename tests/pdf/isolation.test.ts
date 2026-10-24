import test from "node:test";
import assert from "node:assert/strict";
import {mkdtemp,writeFile,rm} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {applicationPdf as direct} from "../../lib/pdf/application-renderer";
import {applicationPdf} from "../../lib/pdf/application";
import {renderPdfIsolated} from "../../lib/pdf/render-isolated";
const fixture={id:'synthetic',name:'Synthetic',jobId:'synthetic',jobTitle:'Synthetic',answers:[{path:'answer',value:'Project experience and measurable results. '.repeat(2500)}]};
test('CPU-bound rendering preserves bytes without blocking the HTTP event loop',async()=>{
 const expected=await direct(fixture);let ticks=0,maxGap=0,last=performance.now();
 const timer=setInterval(()=>{const now=performance.now();maxGap=Math.max(maxGap,now-last);last=now;ticks++;},20);
 try{const actual=await applicationPdf(fixture);assert.deepEqual(actual,expected);assert.ok(ticks>=5);assert.ok(maxGap<1000,`maximum event-loop gap ${maxGap}ms`);}finally{clearInterval(timer);}
});
test('failed and timed-out children release their queue slot for subsequent renders',async()=>{
 const dir=await mkdtemp(path.join(os.tmpdir(),'pdf-isolation-test-'));
 try{
  const bad=path.join(dir,'bad.mjs'),hang=path.join(dir,'hang.mjs');
  await writeFile(bad,'process.exit(1)');await writeFile(hang,'setInterval(()=>{},1000)');
  await assert.rejects(renderPdfIsolated({}, {workerPath:bad}),/application_pdf_/);
  await assert.rejects(renderPdfIsolated({}, {workerPath:hang,timeoutMs:100}),/application_pdf_timeout/);
  const bytes=await applicationPdf({...fixture,answers:[]});assert.equal(Buffer.from(bytes.subarray(0,5)).toString(),'%PDF-');
 }finally{await rm(dir,{recursive:true,force:true});}
});
test('queue capacity is bounded and oversized child output is killed safely',async()=>{
 const dir=await mkdtemp(path.join(os.tmpdir(),'pdf-bounds-test-'));
 try{
  const slow=path.join(dir,'slow.mjs'),huge=path.join(dir,'huge.mjs');
  await writeFile(slow,'process.stdin.resume();setTimeout(()=>process.stdout.write("%PDF-synthetic"),100)');
  const pending=Array.from({length:8},()=>renderPdfIsolated({}, {workerPath:slow}));
  await assert.rejects(renderPdfIsolated({}, {workerPath:slow}),/application_pdf_busy/);
  await Promise.all(pending);
  await writeFile(huge,'process.stdin.resume();process.stdout.write(Buffer.alloc(17*1024*1024))');
  await assert.rejects(renderPdfIsolated({}, {workerPath:huge}),/application_pdf_too_large/);
  assert.equal(Buffer.from((await renderPdfIsolated({}, {workerPath:slow})).subarray(0,5)).toString(),'%PDF-');
 }finally{await rm(dir,{recursive:true,force:true});}
});

test('queue wait expires without releasing the running child slot early',async()=>{
 const dir=await mkdtemp(path.join(os.tmpdir(),'pdf-queue-test-'));
 try{
  const slow=path.join(dir,'slow.mjs');await writeFile(slow,'process.stdin.resume();setTimeout(()=>process.stdout.write("%PDF-synthetic"),250)');
  let firstDone=false;
  const first=renderPdfIsolated({}, {workerPath:slow}).then(()=>{firstDone=true;});
  await assert.rejects(renderPdfIsolated({}, {workerPath:slow,queueTimeoutMs:40}),/application_pdf_timeout/);
  assert.equal(firstDone,false);
  const third=renderPdfIsolated({}, {workerPath:slow}).then(()=>assert.equal(firstDone,true));
  await Promise.all([first,third]);
 }finally{await rm(dir,{recursive:true,force:true});}
});
