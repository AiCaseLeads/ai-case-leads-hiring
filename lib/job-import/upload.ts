import {HiringError} from '../hiring/errors';import {boundedBytes} from '../hiring/files';import {extractPdf} from '../pdf/extract';import {extractWordText,WORD_MIMES} from '../word/extract';
export async function extractJobUpload(request:Request,deps={pdf:extractPdf,word:extractWordText}){
 const mime=request.headers.get('content-type')?.split(';')[0]||'';
 if(!['application/pdf',...WORD_MIMES,'text/plain','text/markdown'].includes(mime))throw new HiringError('unsupported_document',415,'Upload PDF, Word, TXT or Markdown.');
 const bytes=await boundedBytes(request,10*1024*1024);let text='',truncated=false;
 if(mime==='application/pdf'){const r=await deps.pdf(bytes);if(r.status!=='ready')throw new HiringError('document_unreadable',422,'Could not read this PDF. Upload an unlocked text PDF or paste the job description.');text=r.text;truncated=r.truncated||!!r.ocrIncomplete;}
 else if(WORD_MIMES.includes(mime)){const r=await deps.word(bytes,mime);text=r.text;truncated=r.truncated;}
 else{text=new TextDecoder('utf-8',{fatal:true}).decode(bytes);}
 if(truncated||text.length>60000)throw new HiringError('document_too_long',422,'This document is too long to import completely. Paste the job description and questions only.');
 if(text.trim().length<20)throw new HiringError('document_empty',422,'This document contains too little readable text. Paste the job description instead.');
 return {text,notice:'Review the extracted text before preparing the draft.'};
}
