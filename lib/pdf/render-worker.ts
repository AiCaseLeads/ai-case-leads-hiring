import { applicationPdf, exportReportPdf } from "./application-renderer";
const chunks:Buffer[]=[];let size=0;
try {
  for await(const chunk of process.stdin){size+=chunk.length;if(size>16*1024*1024)throw new Error("input_limit");chunks.push(chunk);}
  const request=JSON.parse(Buffer.concat(chunks).toString("utf8"));
  if(!request||!['application','report'].includes(request.kind))throw new Error("invalid_request");
  const pdf=request.kind==='application'?await applicationPdf(request.input):await exportReportPdf(request.input);
  if(pdf.length>16*1024*1024)throw new Error("output_limit");
  process.stdout.write(pdf);
}catch{process.exitCode=1;}
