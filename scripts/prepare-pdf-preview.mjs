import { cp, mkdir, readFile } from "node:fs/promises";
const source=new URL("../node_modules/pdfjs-dist/",import.meta.url);
const {version}=JSON.parse(await readFile(new URL("package.json",source),"utf8"));
const target=new URL(`../public/vendor/pdfjs/${version}/`,import.meta.url);
await mkdir(target,{recursive:true});
for(const [from,to] of [["build/pdf.worker.min.mjs","pdf.worker.min.mjs"],["standard_fonts","standard_fonts"],["cmaps","cmaps"],["wasm","wasm"],["LICENSE","LICENSE"]]) await cp(new URL(from,source),new URL(to,target),{recursive:true});
