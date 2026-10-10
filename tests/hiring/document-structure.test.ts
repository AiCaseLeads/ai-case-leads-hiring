import test from "node:test";
import assert from "node:assert/strict";
import { documentStructure } from "../../lib/hiring/document-structure";
import { samplePdf,sampleDocx,DOCX_MIME,DOCX_PARTS } from "../document-fixture";
test("PDF must have an actual cross-reference structure, not only a magic prefix",()=>{
 const bytes=new TextEncoder().encode(samplePdf());assert.equal(documentStructure(bytes,"application/pdf"),true);
 for(const value of ["%PDF-1.7\n",samplePdf().replace(/startxref\n\d+/,"startxref\n0"),samplePdf().replace("%%EOF","BROKEN")])assert.equal(documentStructure(new TextEncoder().encode(value),"application/pdf"),false);
});
test("Word uploads require bounded valid OOXML parts rather than any ZIP",()=>{
 assert.equal(documentStructure(new Uint8Array([0x50,0x4b,3,4]),DOCX_MIME),false);
 assert.equal(documentStructure(sampleDocx(),DOCX_MIME),true);
 assert.equal(documentStructure(sampleDocx(undefined,false),DOCX_MIME),true);
 assert.equal(documentStructure(sampleDocx({"unrelated.txt":"Zip is not a Word document"}),DOCX_MIME),false);
 const damaged=sampleDocx();damaged[60]^=1;assert.equal(documentStructure(damaged,DOCX_MIME),false);
});
test("malformed, encrypted, traversing, active macro and XML entity packages are rejected",()=>{
 const changes: Record<string,string>[] = [
 {"../escape.xml":"bad"},
 {"word/vbaProject.bin":"macro"},
 {"word/document.xml":'<!DOCTYPE x [<!ENTITY a SYSTEM "file:///secret">]><w:document>&a;</w:document>'}
 ];
 for(const change of changes)assert.equal(documentStructure(sampleDocx({...{
 "[Content_Types].xml":'<Types><Override ContentType="'+DOCX_MIME+'.main+xml"/></Types>',
 "_rels/.rels":'<Relationships><Relationship Target="word/document.xml"/></Relationships>',
 "word/document.xml":'<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"/>'
 },...change}),DOCX_MIME),false);
 const encrypted=sampleDocx();const central=encrypted.indexOf(Buffer.from([0x50,0x4b,1,2]));encrypted.writeUInt16LE(1,central+8);assert.equal(documentStructure(encrypted,DOCX_MIME),false);
 assert.equal(documentStructure(new Uint8Array([0xd0,0xcf,0x11,0xe0,0xa1,0xb1,0x1a,0xe1]),"application/msword"),false);
});

test("OOXML comments cannot substitute for real relationships and malformed XML is rejected",()=>{
 const cases=[
  {...DOCX_PARTS,"[Content_Types].xml":'<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><!-- '+DOCX_MIME+'.main+xml --></Types>'},
  {...DOCX_PARTS,"_rels/.rels":'<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><!-- Target="word/document.xml" --></Relationships>'},
  {...DOCX_PARTS,"word/document.xml":'<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>'},
  {...DOCX_PARTS,"word/document.xml":'<document xmlns="https://unrelated.example.invalid/"/>'},
  {...DOCX_PARTS,"_rels/.rels":DOCX_PARTS["_rels/.rels"].replace('Target="word/document.xml"','Target="word/document.xml" TargetMode="External"')},
 ];
 for(const parts of cases)assert.equal(documentStructure(sampleDocx(parts),DOCX_MIME),false);
});
