// Fixed local text-only reader. Applicant bytes are data, never paths or HTML.
import http from 'node:http';
import https from 'node:https';
import net from 'node:net';
import tls from 'node:tls';
import { documentStructure } from '../lib/hiring/document-structure.ts';
const deny=()=>{throw new Error('external_access_disabled');};
globalThis.fetch=deny;
http.request=http.get=https.request=https.get=net.connect=net.createConnection=tls.connect=deny;
net.Socket.prototype.connect=deny;
const MAX_BYTES=10*1024*1024,MAX_TEXT_BYTES=200000;
let size=0;const chunks=[];
for await(const chunk of process.stdin){size+=chunk.length;if(size>MAX_BYTES)process.exit(2);chunks.push(chunk);}
const bytes=Buffer.concat(chunks),mime=process.argv[2];
let result={status:'invalid',text:'',truncated:false};
try {
  if(!['application/msword','application/vnd.openxmlformats-officedocument.wordprocessingml.document'].includes(mime)||!documentStructure(bytes,mime))throw new Error('invalid');
  if(mime==='application/msword'){
    const {default:OleExtractor}=await import('word-extractor/lib/word-ole-extractor.js');
    const read=OleExtractor.prototype.extractWordDocument;
    OleExtractor.prototype.extractWordDocument=function(document,buffer){
      if(buffer.length<12 || (buffer.readUInt16LE(10)&0x8100))throw new Error('encrypted_document');
      return read.call(this,document,buffer);
    };
  }
  const {default:WordExtractor}=await import('word-extractor');
  const doc=await new WordExtractor().extract(bytes);
  // Plain text only; no rendering, macro evaluation, HTML or relationship fetching.
  let text=[doc.getBody(),doc.getTextboxes(),doc.getHeaders(),doc.getFootnotes(),doc.getEndnotes()].filter(Boolean).join('\n\n').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g,'').trim();
  const encoded=Buffer.from(text,'utf8'),truncated=encoded.length>MAX_TEXT_BYTES;
  if(truncated)text=new TextDecoder('utf-8',{fatal:false}).decode(encoded.subarray(0,MAX_TEXT_BYTES-3)).replace(/\ufffd$/,'');
  result={status:text?'ready':'no_text',text,truncated};
}catch{/* Never expose parser errors or document content in logs. */}
process.stdout.write(JSON.stringify(result));
