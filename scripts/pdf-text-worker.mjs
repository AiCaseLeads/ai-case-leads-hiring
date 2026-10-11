// Fixed, local subprocess entrypoint. Never opens applicant-supplied URLs or files.
const MAX_BYTES = 10 * 1024 * 1024, MAX_PAGES = 30, MAX_TEXT = 30000;
let length = 0; const chunks = [];
for await (const chunk of process.stdin) {
  length += chunk.length;
  if (length > MAX_BYTES) process.exit(2);
  chunks.push(chunk);
}
const bytes = new Uint8Array(Buffer.concat(chunks));
let task;
const result = (status, text = "", pages = 0, truncated = false) => ({status,text,pages,truncated});
let output;
try {
  if (new TextDecoder().decode(bytes.subarray(0,5)) !== "%PDF-") throw new Error("invalid");
  const {getDocument} = await import("pdfjs-dist/legacy/build/pdf.mjs");
  task = getDocument({data:bytes,isEvalSupported:false,disableFontFace:true,useSystemFonts:false,useWorkerFetch:false,useWasm:false,enableXfa:false,stopAtErrors:true,verbosity:0});
  const document = await task.promise;
  if (document.numPages > MAX_PAGES) output = result("too_many_pages","",document.numPages);
  else {
    let text = "", truncated = false;
    for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber++) {
      const page = await document.getPage(pageNumber);
      const stream = page.streamTextContent(), reader = stream.getReader();
      try {
        while (true) {
          const {done,value} = await reader.read(); if (done) break;
          if (truncated) continue;
          for (const item of value.items) {
            if (typeof item.str !== "string") continue;
            const remaining = MAX_TEXT - text.length;
            const addition = item.str + (item.hasEOL ? "\n" : " ");
            text += addition.slice(0, remaining);
            if (addition.length > remaining || text.length >= MAX_TEXT) { truncated = true; break; }
          }
          // Drain this bounded subprocess stream; cancellation races in PDF.js
          // can reject after completion. No further text is retained.
        }
      } finally {reader.releaseLock(); page.cleanup();}
      if (truncated) break;
      text += text.length < MAX_TEXT ? "\n" : "";
    }
    text = text.trim();
    output = result(text ? "ready" : "no_text",text,document.numPages,truncated);
  }
} catch (error) {
  output = result(error?.name === "PasswordException" ? "password_protected" : "invalid");
} finally {await task?.destroy().catch(() => undefined);}
// PDF.js may log diagnostics; parent only accepts the final protocol line.
process.stdout.write("PDF_RESULT:" + JSON.stringify(output) + "\n");
