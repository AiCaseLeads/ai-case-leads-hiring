// Fixed, local subprocess entrypoint. Never opens applicant-supplied URLs or paths.
import { spawn } from "node:child_process";
import { writeFile, readFile, unlink, stat } from "node:fs/promises";
import path from "node:path";
const MAX_BYTES=10*1024*1024, MAX_PAGES=30, MAX_TEXT=30000, MAX_OCR_PAGES=8;
const directory=process.env.PDF_WORK_DIR;
const binaryDirectory=process.env.PDF_OCR_BIN_DIR||"/usr/bin";
const nativeEnvironment={OMP_THREAD_LIMIT:"1"};
// In Railway/Linux, all native decoding is restricted independently of V8.
function native(name,args,timeout=12000) {
  return new Promise((resolve,reject)=>{
    const executable=path.join(binaryDirectory,name);
    const command=process.platform==="linux"?"/usr/bin/prlimit":executable;
    const parameters=process.platform==="linux"?["--as=268435456","--cpu=15","--fsize=16777216","--",executable,...args]:args;
    const child=spawn(command,parameters,{env:nativeEnvironment,stdio:["ignore","pipe","ignore"]});
    let text="",settled=false;
    const finish=(error)=>{if(settled)return;settled=true;clearTimeout(timer);child.kill("SIGKILL");if(error)reject(error);else resolve(text);};
    const timer=setTimeout(()=>finish(new Error("ocr_timeout")),timeout);
    child.on("error",()=>finish(new Error("ocr_unavailable")));
    child.stdout.on("data",chunk=>{text+=chunk.toString();if(Buffer.byteLength(text)>128*1024)finish(new Error("ocr_output_limit"));});
    child.on("close",code=>finish(code===0?null:new Error("ocr_unavailable")));
  });
}
let length=0;const chunks=[];
for await (const chunk of process.stdin){length+=chunk.length;if(length>MAX_BYTES)process.exit(2);chunks.push(chunk);}
const bytes=new Uint8Array(Buffer.concat(chunks));
let task,sourceWritten=false,ocrPages=0,ocrIncomplete=false;
const source=path.join(directory,"original.pdf"),image=path.join(directory,"page.png");
const result=(status,text="",pages=0,truncated=false)=>({status,text,pages,truncated,ocrPages,ocrIncomplete});
let output;
try{
  if(new TextDecoder().decode(bytes.subarray(0,5))!=="%PDF-")throw new Error("invalid");
  const {getDocument,OPS}=await import("pdfjs-dist/legacy/build/pdf.mjs");
  const imageOperations=new Set([OPS.paintImageXObject,OPS.paintInlineImageXObject,OPS.paintImageMaskXObject,OPS.paintImageXObjectRepeat]);
  task=getDocument({data:bytes.slice(),isEvalSupported:false,disableFontFace:true,useSystemFonts:false,useWorkerFetch:false,useWasm:false,enableXfa:false,stopAtErrors:true,verbosity:0});
  const document=await task.promise;
  if(document.numPages>MAX_PAGES)output=result("too_many_pages","",document.numPages);
  else{
    let text="",truncated=false,ocrAttempts=0,ocrFailed=false;
    for(let pageNumber=1;pageNumber<=document.numPages;pageNumber++){
      const page=await document.getPage(pageNumber);
      const stream=page.streamTextContent(),reader=stream.getReader();
      let pageText="";
      try{
        while(true){
          const {done,value}=await reader.read();if(done)break;
          for(const item of value.items){
            if(typeof item.str!=="string")continue;
            const addition=item.str+(item.hasEOL?"\n":" ");
            const remaining=MAX_TEXT-pageText.length;
            pageText+=addition.slice(0,remaining);
            if(addition.length>remaining)truncated=true;
          }
        }
      }finally{reader.releaseLock();}
      pageText=pageText.trim();
      // Mixed PDFs can contain readable headers and scanned experience below.
      // Any image-containing page is OCRed, not merely wholly empty pages.
      const operators=await page.getOperatorList();
      const needsOcr=operators.fnArray.some(op=>imageOperations.has(op))||(!pageText&&operators.fnArray.length>0);
      page.cleanup();
      if(needsOcr){
        if(ocrAttempts>=MAX_OCR_PAGES){ocrIncomplete=true;}
        else{
          ocrAttempts++;
          try{
            if(!sourceWritten){await writeFile(source,bytes,{mode:0o600});sourceWritten=true;}
            // At most 2200 x 2200 pixels, grayscale, one temporary image/page.
            await native("pdftoppm",["-f",String(pageNumber),"-l",String(pageNumber),"-singlefile","-r","200","-scale-to","2200","-gray","-png",source,path.join(directory,"page")]);
            if((await stat(image)).size>16*1024*1024)throw new Error("ocr_image_limit");
            const header=await readFile(image); // capped file size before reading
            if(header.length<24||header.readUInt32BE(16)>2200||header.readUInt32BE(20)>2200)throw new Error("ocr_image_limit");
            const recognized=(await native("tesseract",[image,"stdout","-l","eng+spa","--oem","1","--psm","3"])).trim();
            ocrPages++;
            // Retain native text too when recognition fails to find any text.
            if(recognized){
              const nativeText=pageText.replace(/\s+/g," ").trim();
              // A renderer or OCR model can omit a searchable header. Keep it
              // whenever it was not also recognized, rather than silently lose it.
              pageText=nativeText&&!recognized.replace(/\s+/g," ").includes(nativeText)?pageText+"\n"+recognized:recognized;
            }
          }catch{ocrIncomplete=true;ocrFailed=true;}
          finally{await unlink(image).catch(()=>undefined);}
        }
      }
      const remaining=MAX_TEXT-text.length;
      const addition=pageText+"\n";
      text+=addition.slice(0,remaining);
      if(addition.length>remaining){truncated=true;break;}
    }
    text=text.trim();
    output=result(text?"ready":ocrFailed?"unavailable":"no_text",text,document.numPages,truncated);
  }
}catch(error){output=result(error?.name==="PasswordException"?"password_protected":"invalid");}
finally{await task?.destroy().catch(()=>undefined);}
// Parent only accepts the final protocol line and kills the entire process group.
process.stdout.write("PDF_RESULT:"+JSON.stringify(output)+"\n");
