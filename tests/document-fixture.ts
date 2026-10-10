import { deflateRawSync } from "node:zlib";
export const DOCX_MIME = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
export function samplePdf() {
 const header="%PDF-1.7\n";
 const object="1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n";
 const pages="2 0 obj\n<< /Type /Pages /Kids [] /Count 0 >>\nendobj\n";
 const start=header.length+object.length+pages.length;
 return header+object+pages+"xref\n0 3\n0000000000 65535 f \n"+String(header.length).padStart(10,"0")+" 00000 n \n"+String(header.length+object.length).padStart(10,"0")+" 00000 n \ntrailer\n<< /Size 3 /Root 1 0 R >>\nstartxref\n"+start+"\n%%EOF\n";
}
function crc32(bytes:Uint8Array){let value=0xffffffff;for(const byte of bytes){value^=byte;for(let n=0;n<8;n++)value=(value>>>1)^((value&1)?0xedb88320:0);}return(value^0xffffffff)>>>0;}
export const DOCX_PARTS = {
 "[Content_Types].xml":'<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Override PartName="/word/document.xml" ContentType="'+DOCX_MIME+'.main+xml"/></Types>',
 "_rels/.rels":'<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>',
 "word/document.xml":'<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>Synthetic resume</w:t></w:r></w:p></w:body></w:document>'
};
export function sampleDocx(parts:Record<string,string> = DOCX_PARTS,compress=true) {
 const local:Buffer[]=[],central:Buffer[]=[];let offset=0;
 for(const[name,text]of Object.entries(parts)){
  const filename=Buffer.from(name),raw=Buffer.from(text),data=compress?deflateRawSync(raw):raw,crc=crc32(raw);
  const head=Buffer.alloc(30);head.writeUInt32LE(0x04034b50);head.writeUInt16LE(compress?8:0,8);head.writeUInt32LE(crc,14);head.writeUInt32LE(data.length,18);head.writeUInt32LE(raw.length,22);head.writeUInt16LE(filename.length,26);
  local.push(head,filename,data);
  const directory=Buffer.alloc(46);directory.writeUInt32LE(0x02014b50);directory.writeUInt16LE(compress?8:0,10);directory.writeUInt32LE(crc,16);directory.writeUInt32LE(data.length,20);directory.writeUInt32LE(raw.length,24);directory.writeUInt16LE(filename.length,28);directory.writeUInt32LE(offset,42);central.push(directory,filename);offset+=head.length+filename.length+data.length;
 }
 const end=Buffer.alloc(22);end.writeUInt32LE(0x06054b50);end.writeUInt16LE(Object.keys(parts).length,8);end.writeUInt16LE(Object.keys(parts).length,10);end.writeUInt32LE(central.reduce((sum,b)=>sum+b.length,0),12);end.writeUInt32LE(offset,16);
 return Buffer.concat([...local,...central,end]);
}

