import test from 'node:test';
import {documentStructure} from '../../lib/hiring/document-structure';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {extractWordText} from '../../lib/word/extract';
import {privateApplicationFile} from '../../lib/hub/files';
import {createStore,jobInput,applicationInput,MANAGER} from './fixtures';
import {sampleDocx,DOCX_MIME,DOCX_PARTS} from '../document-fixture';
const legacy=()=>new Uint8Array(readFileSync(new URL('../word/fixtures/legacy.doc',import.meta.url)));

test('bounded worker reads actual DOCX and legacy DOC as Unicode text only',async()=>{
 assert.match((await extractWordText(sampleDocx(),DOCX_MIME)).text,/Synthetic resume/);
 const doc=await extractWordText(legacy(),'application/msword');
 assert.match(doc.text,/This is a test of reviewing/);assert.match(doc.text,/😀/);assert.equal(doc.truncated,false);
});

test('Word preview rejects corrupt, encrypted, entity, traversal, macro and oversized ZIP packages',async()=>{
 const invalid=[new Uint8Array([0x50,0x4b,3,4]),sampleDocx({...DOCX_PARTS,'word/document.xml':'<!DOCTYPE x [<!ENTITY a SYSTEM "http://127.0.0.1/secret">]><w:document>&a;</w:document>'}),sampleDocx({...DOCX_PARTS,'../escape.xml':'escape'}),sampleDocx({...DOCX_PARTS,'word/vbaProject.bin':'macro'}),sampleDocx({...DOCX_PARTS,'_rels/.rels':DOCX_PARTS['_rels/.rels'].replace('Target="word/document.xml"','Target="https://example.invalid/private" TargetMode="External"')})];
 const bomb=sampleDocx();const central=bomb.indexOf(Buffer.from([0x50,0x4b,1,2]));bomb.writeUInt32LE(100*1024*1024,central+24);invalid.push(bomb);
 const encrypted=sampleDocx();encrypted.writeUInt16LE(1,encrypted.indexOf(Buffer.from([0x50,0x4b,1,2]))+8);invalid.push(encrypted);
 for(const bytes of invalid)await assert.rejects(extractWordText(bytes,DOCX_MIME),{code:'preview_unavailable'});
 await assert.rejects(extractWordText(new Uint8Array(10*1024*1024+1),DOCX_MIME),{code:'preview_unavailable'});
 await assert.rejects(extractWordText(new Uint8Array([0xd0,0xcf,0x11,0xe0]),'application/msword'),{code:'preview_unavailable'});
 const encryptedDoc=Buffer.from(legacy()),fib=encryptedDoc.indexOf(Buffer.from([0xec,0xa5]));assert.ok(fib>0);encryptedDoc.writeUInt16LE(encryptedDoc.readUInt16LE(fib+10)|0x0100,fib+10);
 await assert.rejects(extractWordText(encryptedDoc,'application/msword'),{code:'preview_unavailable'});
});

test('text output is bounded and timeouts release parser capacity',async()=>{
 const big=sampleDocx({...DOCX_PARTS,'word/document.xml':DOCX_PARTS['word/document.xml'].replace('Synthetic resume','word '.repeat(50000))});
 const parsed=await extractWordText(big,DOCX_MIME);assert.equal(parsed.truncated,true);assert.ok(Buffer.byteLength(parsed.text)<=200000);
 await assert.rejects(extractWordText(sampleDocx(),DOCX_MIME,1),{code:'word_preview_timeout'});
 const first=extractWordText(sampleDocx(),DOCX_MIME),second=extractWordText(sampleDocx(),DOCX_MIME);
 await assert.rejects(extractWordText(sampleDocx(),DOCX_MIME),{code:'word_preview_busy'});await Promise.all([first,second]);
 assert.match((await extractWordText(sampleDocx(),DOCX_MIME)).text,/Synthetic resume/);
});

test('Word API preview authenticates, verifies identity and serves private text; HEAD avoids parsing',async()=>{
 const {store,database,db}=createStore();try {
  const job=await store.saveJob(jobInput()),app=await store.acceptApplication(applicationInput(job.id)),bytes=sampleDocx();
  database.prepare("INSERT INTO hub_files(id,session_hash,job_id,field_path,filename,content_type,size,object_key,expires_at,uploaded_at,application_id) VALUES('word','test',?,'resume','Resume.docx',?,?,'word-key',1,1,?)").run(job.id,DOCX_MIME,bytes.length,app.id);
  const bucket=(input:Uint8Array=bytes,fileId='word')=>({get:async()=>({size:bytes.length,customMetadata:{fileId},body:new Response(input as BodyInit).body!})}) as unknown as Pick<R2Bucket,'get'>;
  const request=(method='GET')=>new Request('https://jobs.example.invalid/api/files/word?preview=1',{method});
  await assert.rejects(privateApplicationFile(request(),'word',null,db,bucket()),{code:'staff_access_required'});
  await assert.rejects(privateApplicationFile(request(),'word',MANAGER,db,bucket(bytes,'other')),{code:'file_identity_mismatch'});
  const response=await privateApplicationFile(request(),'word',MANAGER,db,bucket());assert.equal(response.headers.get('Content-Type'),'text/plain; charset=utf-8');assert.equal(response.headers.get('X-Preview-Format'),'word-text');assert.equal(response.headers.get('Cache-Control'),'private, no-store');assert.equal(response.headers.get('X-Content-Type-Options'),'nosniff');assert.match(await response.text(),/Synthetic resume/);
  const broken=Uint8Array.from(bytes);broken[60]^=1;
  const head=await privateApplicationFile(request('HEAD'),'word',MANAGER,db,bucket(broken));assert.equal(head.status,200);assert.equal(await head.text(),'');
  await assert.rejects(privateApplicationFile(request(),'word',MANAGER,db,bucket(broken)),{code:'preview_unavailable'});
  const formattedRequest=new Request('https://jobs.example.invalid/api/files/word?preview=1&format=docx');
  const formatted=await privateApplicationFile(formattedRequest,'word',MANAGER,db,bucket());assert.equal(formatted.headers.get('Content-Type'),DOCX_MIME);assert.deepEqual(new Uint8Array(await formatted.arrayBuffer()),new Uint8Array(bytes));
  await assert.rejects(privateApplicationFile(formattedRequest,'word',MANAGER,db,bucket(broken)),{code:'preview_unavailable'});
  const original=await privateApplicationFile(new Request('https://jobs.example.invalid/api/files/word'),'word',MANAGER,db,bucket());assert.equal(original.headers.get('Content-Type'),DOCX_MIME);assert.match(original.headers.get('Content-Disposition')!,/^attachment/);assert.deepEqual(new Uint8Array(await original.arrayBuffer()),new Uint8Array(bytes));
 }finally{database.close();}
});

test('formatted preview validates actual expansion and CRC of media and auxiliary XML',()=>{
 const bytes=sampleDocx({...DOCX_PARTS,'word/media/image.png':'x'.repeat(4096),'word/styles.xml':'<styles/>'});
 assert.equal(documentStructure(bytes,DOCX_MIME,true),true);
 const central=bytes.indexOf(Buffer.from([0x50,0x4b,1,2]));const media=bytes.indexOf(Buffer.from('word/media/image.png'),central)-46;
 const bomb=Buffer.from(bytes);bomb.writeUInt32LE(1,media+24);assert.equal(documentStructure(bomb,DOCX_MIME),true);assert.equal(documentStructure(bomb,DOCX_MIME,true),false);
 const crc=Buffer.from(bytes);crc.writeUInt32LE(0,media+16);assert.equal(documentStructure(crc,DOCX_MIME,true),false);
 const entity=sampleDocx({...DOCX_PARTS,'word/styles.xml':'<!DOCTYPE x [<!ENTITY a SYSTEM "https://example.invalid/leak">]><styles/>'});assert.equal(documentStructure(entity,DOCX_MIME,true),false);
});
