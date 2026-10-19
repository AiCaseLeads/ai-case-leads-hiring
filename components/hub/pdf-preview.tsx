"use client";
import {useEffect,useRef,useState} from "react";
import {ChevronLeft,ChevronRight} from "lucide-react";
import type {PDFDocumentProxy,RenderTask} from "pdfjs-dist";
export function PdfPreview({url,filename,expanded=false}:{url:string;filename:string;expanded?:boolean}){
 const [fit,setFit]=useState<"page"|"width">("page");
 const canvas=useRef<HTMLCanvasElement>(null),container=useRef<HTMLDivElement>(null);
 const [document,setDocument]=useState<PDFDocumentProxy|null>(null),[page,setPage]=useState(1),[width,setWidth]=useState(600),[error,setError]=useState(""),[rendered,setRendered]=useState(false);
 useEffect(()=>{
  const element=container.current;if(!element)return;
  const observer=new ResizeObserver(entries=>setWidth(Math.max(1,Math.min(1100,Math.floor(entries[0].contentRect.width)))));observer.observe(element);return()=>observer.disconnect();
 },[]);
 useEffect(()=>{
  const controller=new AbortController();let cancelled=false;let loading:ReturnType<typeof import("pdfjs-dist")["getDocument"]>|undefined;
  void(async()=>{
   try{
    const pdfjs=await import("pdfjs-dist");if(cancelled)return;
    const assets=`/vendor/pdfjs/${pdfjs.version}/`;
    pdfjs.GlobalWorkerOptions.workerSrc=assets+"pdf.worker.min.mjs";
    const response=await fetch(url,{credentials:"same-origin",cache:"no-store",signal:controller.signal});
    if(!response.ok || !(response.headers.get("content-type") || "").startsWith("application/pdf"))throw Error("Unable to load this résumé securely.");
    const bytes=new Uint8Array(await response.arrayBuffer());if(cancelled)return;
    loading=pdfjs.getDocument({data:bytes,standardFontDataUrl:assets+"standard_fonts/",cMapUrl:assets+"cmaps/",cMapPacked:true,wasmUrl:assets+"wasm/"});
    const next=await loading.promise;if(cancelled){await loading.destroy();return;}setDocument(next);
   }catch{if(!cancelled)setError("Résumé preview could not be loaded. Use the Download link above to open the original file.");}
  })();
  return()=>{cancelled=true;controller.abort();void loading?.destroy();};
 },[url]);
 useEffect(()=>{
  if(!document || !canvas.current)return;
  let cancelled=false,task:RenderTask|undefined;
  const target=canvas.current;
  void(async()=>{try{
   setRendered(false);const pdfPage=await document.getPage(page);if(cancelled)return;
   const natural=pdfPage.getViewport({scale:1});const scale=Math.min(Math.max(1,width-18)/natural.width,fit==="page"?(expanded?640:width<400?240:420)/natural.height:2);const viewport=pdfPage.getViewport({scale});
   const ratio=Math.min(window.devicePixelRatio || 1,2,Math.sqrt(4000000/(viewport.width*viewport.height)));
   target.width=Math.floor(viewport.width*ratio);target.height=Math.floor(viewport.height*ratio);target.style.width=`${viewport.width}px`;target.style.height=`${viewport.height}px`;
   const context=target.getContext("2d");if(!context)throw Error("Canvas unavailable");
   task=pdfPage.render({canvas:target,canvasContext:context,viewport,transform:ratio!==1?[ratio,0,0,ratio,0,0]:undefined});await task.promise;
   if(!cancelled)setRendered(true);
  }catch{if(!cancelled)setError("This résumé page could not be displayed. Use the Download link above to open the original file.");}})();
  return()=>{cancelled=true;task?.cancel();};
 },[document,page,width,fit,expanded]);
 return <div ref={container} style={{minWidth:0,width:"100%"}}>
  {document && <div className="hub-document-toolbar"><button type="button" className="hub-icon-button" aria-label="Previous résumé page" title="Previous page" disabled={page<=1} onClick={()=>setPage(value=>value-1)}><ChevronLeft size={16} aria-hidden="true"/></button><span className="hub-document-page-count" role="status">{page} / {document.numPages}</span><button type="button" className="hub-icon-button" aria-label="Next résumé page" title="Next page" disabled={page>=document.numPages} onClick={()=>setPage(value=>value+1)}><ChevronRight size={16} aria-hidden="true"/></button><select aria-label="Document zoom" value={fit} onChange={event=>setFit(event.target.value as "page"|"width")}><option value="page">Fit page</option><option value="width">Fit width</option></select></div>}
  {error ? <p role="status">{error}</p> : <>
   {!rendered && <p role="status">Rendering résumé…</p>}
   <div className={"hub-resume-canvas-window hub-document-stage"+(fit==="page"?" is-fit-page":"")}><canvas ref={canvas} role="img" aria-label={`Résumé ${filename}, page ${page}`} data-rendered={rendered?"true":"false"} style={{display:"block",maxWidth:"100%",margin:"0 auto"}}/></div>
   <p className="hub-document-caption">Download the original for selectable text and screen-reader access.</p>
  </>}
 </div>;
}
