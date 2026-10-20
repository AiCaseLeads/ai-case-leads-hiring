"use client";
import {useEffect,useRef,useState} from "react";
const frameHtml=`<!doctype html><html><head><meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data: blob:; font-src data: blob:; style-src 'unsafe-inline'; connect-src 'none'; frame-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'"><style>html,body{margin:0;background:#edf1f0}#document{transform-origin:top left}.docx-wrapper{padding:12px!important}.docx-wrapper>section.docx{margin-bottom:12px!important;box-shadow:none!important}</style></head><body><div id="document"></div></body></html>`;
/** Render stored OOXML inside a scriptless, network-blocked frame; Drive sync is independent. */
export function DocxPreview({fileId,filename,expanded=false}:{fileId:string;filename:string;expanded?:boolean}){
 const frame=useRef<HTMLIFrameElement>(null);const[attempt,setAttempt]=useState(0),[status,setStatus]=useState<'loading'|'ready'|'error'>('loading');
 useEffect(()=>{
  let disposed=false,observer:ResizeObserver|undefined;const controller=new AbortController();queueMicrotask(()=>{if(!disposed)setStatus('loading');});
  void(async()=>{try{
   const response=await fetch(`/api/files/${encodeURIComponent(fileId)}?preview=1&format=docx`,{credentials:'same-origin',cache:'no-store',signal:controller.signal});
   if(!response.ok||!response.headers.get('content-type')?.startsWith('application/vnd.openxmlformats-officedocument.wordprocessingml.document'))throw Error('unavailable');
   const bytes=await response.arrayBuffer();if(bytes.byteLength>10*1024*1024)throw Error('oversize');
   const renderer=await import('docx-preview');if(disposed)return;
   const element=frame.current,doc=element?.contentDocument;if(!element||!doc)throw Error('frame');
   doc.open();doc.write(frameHtml);doc.close();const host=doc.getElementById('document')!;
   doc.addEventListener('click',event=>{if((event.target as Element)?.closest?.('a'))event.preventDefault();},true);
   await renderer.renderAsync(bytes,host,host,{inWrapper:true,ignoreWidth:false,ignoreHeight:false,ignoreFonts:true,breakPages:true,renderHeaders:true,renderFooters:true,renderFootnotes:true,renderEndnotes:true,renderComments:false,renderAltChunks:false,experimental:false,useBase64URL:true});
   if(disposed)return;
   host.querySelectorAll('a').forEach(link=>{link.removeAttribute('href');link.removeAttribute('target');});
   if(!host.querySelector('section.docx'))throw Error('empty');
   const fit=()=>{host.style.width='max-content';host.style.zoom='1';const width=host.scrollWidth;host.style.zoom=String(Math.min(1,Math.max(1,element.clientWidth-2)/Math.max(1,width)));};fit();observer=new ResizeObserver(fit);observer.observe(element);setStatus('ready');
  }catch{if(!disposed)setStatus('error');}})();
  return()=>{disposed=true;controller.abort();observer?.disconnect();};
 },[fileId,attempt]);
 return <div>{status==='loading'&&<p role="status">Opening formatted résumé…</p>}{status==='error'&&<p role="status">This Word document could not be previewed. <button type="button" className="hub-text-button" onClick={()=>setAttempt(value=>value+1)}>Retry résumé preview</button> or use Download above.</p>}<iframe ref={frame} title={`Formatted résumé: ${filename}`} sandbox="allow-same-origin" referrerPolicy="no-referrer" style={{display:status==='ready'?'block':'none',width:'100%',height:expanded?'min(70vh,700px)':'340px',border:'1px solid #dce7e4',borderRadius:4}}/><p className="hub-document-caption">Formatted Word preview. Download the original for editing or selectable links.</p></div>;
}
