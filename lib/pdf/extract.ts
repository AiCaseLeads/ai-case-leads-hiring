import { spawn } from "node:child_process";
import path from "node:path";
import { MAX_PDF_BYTES, type PdfResult } from "./types";
import { HiringError } from "../hiring/errors";
const messages:Record<PdfResult["status"],string> = {
  ready:"Text read from the uploaded PDF. Check the preview against the original before using it.",
  no_text:"This PDF has no readable text; it may be a scan. Ask for a text-based PDF or enter relevant excerpts manually. No document was sent to an external OCR service.",
  password_protected:"This PDF requires a password. Ask the candidate for an unlocked copy or enter relevant excerpts manually.",
  invalid:"This PDF could not be read safely. Open the original and request a newly exported copy or enter relevant excerpts manually.",
  too_many_pages:"Automatic reading supports PDFs up to 30 pages. Open the original and enter relevant excerpts manually.",
  too_large:"Automatic reading supports PDFs up to 10 MB. Open the original and enter relevant excerpts manually.",
  timeout:"Reading this PDF took too long. The original is safe; retry later or enter relevant excerpts manually.",
  unavailable:"PDF reading is temporarily unavailable. The original is safe; retry later or enter relevant excerpts manually.",
};
export function pdfResult(status:PdfResult["status"],text="",pages=0,truncated=false):PdfResult {
  return {status,text,pages,truncated,message:messages[status]};
}
let active = 0;
/** CPU/memory-bounded child process, never on the HTTP event loop. No unbounded queue. */
export async function extractPdf(bytes:Uint8Array, timeoutMs=15000):Promise<PdfResult> {
  if(bytes.length > MAX_PDF_BYTES)return pdfResult("too_large");
  if(new TextDecoder().decode(bytes.subarray(0,5))!=="%PDF-")return pdfResult("invalid");
  if(active>=2)throw new HiringError("pdf_busy",429,"Two PDFs are being read. Please retry in a moment; applications can still be submitted.");
  active++;
  try {
    return await new Promise<PdfResult>(resolve => {
      // No app credentials are inherited by the parser subprocess.
      const child=spawn(process.execPath,["--max-old-space-size=192",path.resolve(process.cwd(),"scripts/pdf-text-worker.mjs")],{stdio:["pipe","pipe","ignore"],env:{NODE_ENV:"production"},windowsHide:true});
      let output="",settled=false;
      const finish=(result:PdfResult)=>{if(settled)return;settled=true;clearTimeout(timer);child.kill("SIGKILL");resolve(result);};
      const timer=setTimeout(()=>finish(pdfResult("timeout")),Math.min(Math.max(timeoutMs,1),15000));
      child.on("error",()=>finish(pdfResult("unavailable")));
      child.stdin.on("error",()=>undefined);
      child.stdout.on("data",chunk=>{output+=chunk.toString();if(Buffer.byteLength(output)>256*1024)finish(pdfResult("invalid"));});
      child.on("close",code=>{
        if(code!==0)return finish(pdfResult("unavailable"));
        try {
          const line=output.split("\n").findLast(line=>line.startsWith("PDF_RESULT:"));
          const data=JSON.parse(line!.slice(11));
          if(!Object.hasOwn(messages,data.status)||typeof data.text!=="string"||data.text.length>30000||!Number.isSafeInteger(data.pages)||data.pages<0||typeof data.truncated!=="boolean")throw new Error("invalid");
          finish(pdfResult(data.status,data.text,data.pages,data.truncated));
        }catch{finish(pdfResult("invalid"));}
      });
      child.stdin.end(bytes);
    });
  } finally {active--;}
}
