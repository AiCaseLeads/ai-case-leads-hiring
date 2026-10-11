/** Small real PDF fixture with exact xref offsets, no third-party candidate data. */
export function makePdf(text="Built React applications for two years.",pages=1,encrypt=false):Uint8Array{
  const objects:string[]=["<< /Type /Catalog /Pages 2 0 R >>","", "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>"];
  const kids:number[]=[];
  for(let p=0;p<pages;p++){
    const page=objects.length+1; kids.push(page);
    objects.push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 3 0 R >> >> /Contents ${page+1} 0 R >>`);
    const lines=text.match(/.{1,60}/g)||[];
    const content=text?`BT /F1 12 Tf 14 TL 50 750 Td ${lines.map(line=>`(${line.replace(/[\\()]/g,"\\$&")}) Tj T*`).join(" ")} ET`:"";
    objects.push(`<< /Length ${Buffer.byteLength(content)} >>\nstream\n${content}\nendstream`);
  }
  objects[1]=`<< /Type /Pages /Count ${pages} /Kids [${kids.map(n=>`${n} 0 R`).join(" ")}] >>`;
  if(encrypt)objects.push(`<< /Filter /Standard /V 1 /R 2 /Length 40 /O <${"00".repeat(32)}> /U <${"00".repeat(32)}> /P -4 >>`);
  let pdf="%PDF-1.4\n";const offsets=[0];
  objects.forEach((object,index)=>{offsets.push(Buffer.byteLength(pdf));pdf+=`${index+1} 0 obj\n${object}\nendobj\n`;});
  const xref=Buffer.byteLength(pdf);
  pdf+=`xref\n0 ${objects.length+1}\n0000000000 65535 f \n${offsets.slice(1).map(offset=>String(offset).padStart(10,"0")+" 00000 n \n").join("")}trailer\n<< /Size ${objects.length+1} /Root 1 0 R${encrypt?` /Encrypt ${objects.length} 0 R /ID [<${"01".repeat(16)}> <${"01".repeat(16)}>]`:""} >>\nstartxref\n${xref}\n%%EOF\n`;
  return new TextEncoder().encode(pdf);
}

/** Image-only text: no searchable layer, so a passing test requires real OCR. */
export function makeScannedPdf(image:Uint8Array,pages=1,nativeHeader=""):Uint8Array{
  const binary=Buffer.from(image);
  const objects:Buffer[]=[Buffer.from("<< /Type /Catalog /Pages 2 0 R >>"),Buffer.alloc(0),Buffer.from("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>")];
  const imageId=4;
  objects.push(Buffer.concat([Buffer.from(`<< /Type /XObject /Subtype /Image /Width 900 /Height 400 /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${binary.length} >>\nstream\n`),binary,Buffer.from("\nendstream")]));
  const kids:number[]=[];
  for(let index=0;index<pages;index++){
    const page=objects.length+1;kids.push(page);
    objects.push(Buffer.from(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 3 0 R >> /XObject << /I1 ${imageId} 0 R >> >> /Contents ${page+1} 0 R >>`));
    const content=`${nativeHeader?`BT /F1 18 Tf 50 750 Td (${nativeHeader.replace(/[\\()]/g,"\\$&")}) Tj ET `:""}q 510 0 0 227 50 480 cm /I1 Do Q`;
    objects.push(Buffer.from(`<< /Length ${Buffer.byteLength(content)} >>\nstream\n${content}\nendstream`));
  }
  objects[1]=Buffer.from(`<< /Type /Pages /Count ${pages} /Kids [${kids.map(id=>`${id} 0 R`).join(" ")}] >>`);
  const chunks=[Buffer.from("%PDF-1.4\n")],offsets=[0];let length=chunks[0].length;
  objects.forEach((object,index)=>{offsets.push(length);const data=Buffer.concat([Buffer.from(`${index+1} 0 obj\n`),object,Buffer.from("\nendobj\n")]);chunks.push(data);length+=data.length;});
  chunks.push(Buffer.from(`xref\n0 ${objects.length+1}\n0000000000 65535 f \n${offsets.slice(1).map(offset=>String(offset).padStart(10,"0")+" 00000 n \n").join("")}trailer\n<< /Size ${objects.length+1} /Root 1 0 R >>\nstartxref\n${length}\n%%EOF\n`));
  return new Uint8Array(Buffer.concat(chunks));
}
