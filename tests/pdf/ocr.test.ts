import assert from "node:assert/strict";
import test from "node:test";
import { access, readFile, mkdtemp, rm, writeFile, symlink, readdir } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { extractPdf } from "../../lib/pdf/extract";
import { makeScannedPdf } from "./fixtures";
const raster=await readFile(new URL("./fixtures/synthetic-scanned-resume.jpg",import.meta.url));
const directory=process.env.PDF_OCR_BIN_DIR||"/usr/bin";
let available=true;
try{await access(path.join(directory,"tesseract"));await access(path.join(directory,"pdftoppm"));}catch{available=false;}
// Run in Railway's Docker image or with a trusted local native binary directory.
test("real local OCR reads image-only and mixed-image PDF experience",{skip:!available},async()=>{
  for(const header of ["","Resume header already has searchable text"]){
    const result=await extractPdf(makeScannedPdf(raster,1,header));
    assert.equal(result.status,"ready",JSON.stringify(result));
    assert.match(result.text,/Synthetic OCR Candidate/i);assert.match(result.text,/Built React applications/i);
    assert.match(result.text,/creative strategy in Spain/i);assert.equal(result.ocrPages,1);assert.equal(result.ocrIncomplete,false);
    if(header)assert.match(result.text,/searchable text/i);
    assert.match(result.message,/OCR can misread/);
  }
});
test("real OCR page cap is explicit and preserves the original PDF",{skip:!available},async()=>{
  const bytes=makeScannedPdf(raster,9),copy=bytes.slice();
  const result=await extractPdf(bytes);
  assert.equal(result.status,"ready",JSON.stringify(result));assert.equal(result.pages,9);assert.equal(result.ocrPages,8);
  assert.equal(result.ocrIncomplete,true);assert.match(result.message,/Some image text could not be read/);
  assert.deepEqual(bytes,copy);
});
test("missing OCR binaries fail safely and remain retryable",async()=>{
  const previous=process.env.PDF_OCR_BIN_DIR;process.env.PDF_OCR_BIN_DIR="/nonexistent-hiring-ocr-bin";
  try{const result=await extractPdf(makeScannedPdf(raster));assert.equal(result.status,"unavailable");assert.equal(result.ocrIncomplete,true);}
  finally{if(previous)process.env.PDF_OCR_BIN_DIR=previous;else delete process.env.PDF_OCR_BIN_DIR;}
});
test("OCR hard deadline kills native descendants and deletes temporary originals",{skip:!available||process.platform==="win32"},async()=>{
  const temporary=await mkdtemp(path.join(os.tmpdir(),"ocr-test-")),marker=path.join(temporary,"started");
  const previous=process.env.PDF_OCR_BIN_DIR;
  const initial=new Set((await readdir(os.tmpdir())).filter(value=>value.startsWith("hiring-pdf-")));
  try{
    await symlink(path.join(directory,"pdftoppm"),path.join(temporary,"pdftoppm"));
    // Test-only executable intentionally stalls after the real page renderer.
    await writeFile(path.join(temporary,"tesseract"),`#!/bin/sh\nprintf '%s' "$$" > '${marker}'\nexec /bin/sleep 30\n`,{mode:0o700});
    process.env.PDF_OCR_BIN_DIR=temporary;
    const result=await extractPdf(makeScannedPdf(raster),2500);assert.equal(result.status,"timeout");
    const pid=Number(await readFile(marker,"utf8"));
    await new Promise(resolve=>setTimeout(resolve,100));
    assert.throws(()=>process.kill(pid,0));
    const remaining=(await readdir(os.tmpdir())).filter(value=>value.startsWith("hiring-pdf-")&&!initial.has(value));
    assert.deepEqual(remaining,[]);
  }finally{if(previous)process.env.PDF_OCR_BIN_DIR=previous;else delete process.env.PDF_OCR_BIN_DIR;await rm(temporary,{recursive:true,force:true});}
});
