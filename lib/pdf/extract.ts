import { spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { MAX_PDF_BYTES, type PdfResult } from "./types";
import { HiringError } from "../hiring/errors";
const messages:Record<PdfResult["status"],string> = {
  ready:"Text read from the uploaded PDF. Check the preview against the original before using it.",
  no_text:"No usable text was found, including local OCR where needed. Open the original or ask for a clearer PDF. Nothing was sent to an external OCR service.",
  password_protected:"This PDF requires a password. Ask the candidate for an unlocked copy or enter relevant excerpts manually.",
  invalid:"This PDF could not be read safely. Open the original and request a newly exported copy or enter relevant excerpts manually.",
  too_many_pages:"Automatic reading supports PDFs up to 30 pages. Open the original and enter relevant excerpts manually.",
  too_large:"Automatic reading supports PDFs up to 10 MB. Open the original and enter relevant excerpts manually.",
  timeout:"Reading this PDF took too long. The original is safe; retry later or enter relevant excerpts manually.",
  unavailable:"PDF reading or local OCR is temporarily unavailable. The original is safe; retry later or enter relevant excerpts manually.",
};
export function pdfResult(status:PdfResult["status"],text="",pages=0,truncated=false,ocrPages=0,ocrIncomplete=false):PdfResult {
  let message=messages[status];
  if(status==="ready"&&ocrPages)message=`Local OCR read ${ocrPages} scanned or image-containing page${ocrPages===1?"":"s"}. OCR can misread names, dates and columns; check the original before grading.`;
  if(ocrIncomplete)message+=" Some image text could not be read. OCR supports at most 8 pages per PDF; inspect the original for missing evidence.";
  return {status,text,pages,truncated,message,ocrPages,ocrIncomplete};
}
let active = 0;
/** CPU/memory-bounded child process, never on the HTTP event loop. No unbounded queue. */
export async function extractPdf(bytes:Uint8Array, timeoutMs=45000):Promise<PdfResult> {
  if(bytes.length > MAX_PDF_BYTES)return pdfResult("too_large");
  if(new TextDecoder().decode(bytes.subarray(0,5))!=="%PDF-")return pdfResult("invalid");
  if(active>=1)throw new HiringError("pdf_busy",429,"A PDF is being read. Please retry in a moment; applications can still be submitted.");
  active++;
  let temporaryDirectory:string|undefined;
  try {
    temporaryDirectory=await mkdtemp(path.join(os.tmpdir(),"hiring-pdf-"));
    return await new Promise<PdfResult>(resolve => {
      // A trusted server-only binary directory supports local testing. No app
      // credentials or arbitrary caller-controlled paths reach either parser.
      const binaryDirectory=process.env.PDF_OCR_BIN_DIR;
      const child=spawn(process.execPath,["--max-old-space-size=192",path.resolve(process.cwd(),"scripts/pdf-text-worker.mjs")],{stdio:["pipe","pipe","ignore"],env:{NODE_ENV:"production",PDF_WORK_DIR:temporaryDirectory!,...(binaryDirectory&&path.isAbsolute(binaryDirectory)?{PDF_OCR_BIN_DIR:binaryDirectory}:{}),OMP_THREAD_LIMIT:"1"},windowsHide:true,detached:process.platform!=="win32"});
      let output="",settled=false;
      const kill=()=>{try{if(process.platform!=="win32"&&child.pid)process.kill(-child.pid,"SIGKILL");else child.kill("SIGKILL");}catch{/* Process group already exited. */}};
      const finish=(result:PdfResult)=>{if(settled)return;settled=true;clearTimeout(timer);kill();resolve(result);};
      const timer=setTimeout(()=>finish(pdfResult("timeout")),Math.min(Math.max(timeoutMs,1),45000));
      child.on("error",()=>finish(pdfResult("unavailable")));
      child.stdin.on("error",()=>undefined);
      child.stdout.on("data",chunk=>{output+=chunk.toString();if(Buffer.byteLength(output)>256*1024)finish(pdfResult("invalid"));});
      child.on("close",code=>{
        if(code!==0)return finish(pdfResult("unavailable"));
        try {
          const line=output.split("\n").findLast(line=>line.startsWith("PDF_RESULT:"));
          const data=JSON.parse(line!.slice(11));
          if(!Object.hasOwn(messages,data.status)||typeof data.text!=="string"||data.text.length>30000||!Number.isSafeInteger(data.pages)||data.pages<0||typeof data.truncated!=="boolean"||!Number.isSafeInteger(data.ocrPages)||data.ocrPages<0||data.ocrPages>8||typeof data.ocrIncomplete!=="boolean")throw new Error("invalid");
          finish(pdfResult(data.status,data.text,data.pages,data.truncated,data.ocrPages,data.ocrIncomplete));
        }catch{finish(pdfResult("invalid"));}
      });
      child.stdin.end(bytes);
    });
  } finally {
    // The whole parser/native process group has exited or been killed first.
    if(temporaryDirectory)await rm(temporaryDirectory,{recursive:true,force:true}).catch(()=>undefined);
    active--;
  }
}
