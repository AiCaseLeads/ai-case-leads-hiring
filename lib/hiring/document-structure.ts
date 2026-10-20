import { inflateRawSync } from "node:zlib";
import { XMLParser, XMLValidator } from "fast-xml-parser";

const decoder = new TextDecoder();
const WORD = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
const TYPES_NS = "http://schemas.openxmlformats.org/package/2006/content-types";
const RELS_NS = "http://schemas.openxmlformats.org/package/2006/relationships";
const WORD_NS = new Set(["http://schemas.openxmlformats.org/wordprocessingml/2006/main", "http://purl.oclc.org/ooxml/wordprocessingml/main"]);
const OFFICE_REL = new Set(["http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument", "http://purl.oclc.org/ooxml/officeDocument/relationships/officeDocument"]);
type XmlNode = Record<string, unknown>;
function object(value: unknown): value is XmlNode { return !!value && typeof value === "object" && !Array.isArray(value); }
function qualified(name: string, node: XmlNode, inherited: XmlNode = {}) {
  const [prefix, local] = name.includes(":") ? name.split(":") : ["", name];
  return {local, namespace: node[prefix ? "@xmlns:" + prefix : "@xmlns"] ?? inherited[prefix ? "@xmlns:" + prefix : "@xmlns"]};
}
function xmlRoot(text: string, name: string, namespaces: Set<string>) {
  if (/<!DOCTYPE|<!ENTITY/i.test(text) || XMLValidator.validate(text, {allowBooleanAttributes: false}) !== true) return null;
  const parsed: unknown = new XMLParser({ignoreAttributes: false, attributeNamePrefix: "@", processEntities: false, parseTagValue: false, parseAttributeValue: false}).parse(text);
  if (!object(parsed)) return null;
  const roots = Object.entries(parsed).filter(([key]) => !key.startsWith("?") && !key.startsWith("#"));
  if (roots.length !== 1 || !object(roots[0][1])) return null;
  const node = roots[0][1], q = qualified(roots[0][0], node);
  return q.local === name && typeof q.namespace === "string" && namespaces.has(q.namespace) ? node : null;
}
function children(node: XmlNode, name: string, namespace: string): XmlNode[] {
  return Object.entries(node).flatMap(([key, value]) => {
    if (key.startsWith("@") || key.startsWith("#")) return [];
    return (Array.isArray(value) ? value : [value]).filter(object).filter(child => {
      const q = qualified(key, child, node); return q.local === name && q.namespace === namespace;
    });
  });
}
function crc32(bytes: Uint8Array) {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}
/** Check bounded OOXML ZIP structure, required XML parts, and their integrity. */
function docx(bytes: Uint8Array, strictPreview = false): boolean {
  if (bytes.length < 22) return false;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let eocd = -1;
  for (let p = bytes.length - 22; p >= Math.max(0, bytes.length - 65557); p--) {
    if (view.getUint32(p, true) === 0x06054b50 && p + 22 + view.getUint16(p + 20, true) === bytes.length) { eocd = p; break; }
  }
  if (eocd < 0 || view.getUint16(eocd + 4, true) || view.getUint16(eocd + 6, true)) return false;
  const count = view.getUint16(eocd + 10, true), size = view.getUint32(eocd + 12, true), start = view.getUint32(eocd + 16, true);
  if (!count || count > 1000 || count !== view.getUint16(eocd + 8, true) || start + size !== eocd) return false;
  const wanted = new Set(["[Content_Types].xml", "_rels/.rels", "word/document.xml"]);
  const xml = new Map<string, string>(), names = new Set<string>();
  let p = start, totalInflated = 0;
  for (let n = 0; n < count; n++) {
    if (p + 46 > eocd || view.getUint32(p, true) !== 0x02014b50) return false;
    const flags = view.getUint16(p + 8, true), method = view.getUint16(p + 10, true), crc = view.getUint32(p + 16, true);
    const packed = view.getUint32(p + 20, true), inflated = view.getUint32(p + 24, true);
    const nameLength = view.getUint16(p + 28, true), extra = view.getUint16(p + 30, true), comment = view.getUint16(p + 32, true), local = view.getUint32(p + 42, true);
    const next = p + 46 + nameLength + extra + comment;
    if (next > eocd || flags & 1 || ![0, 8].includes(method) || local + 30 > start) return false;
    const name = decoder.decode(bytes.subarray(p + 46, p + 46 + nameLength));
    if (!name || names.has(name) || name.startsWith("/") || name.includes("\\") || name.split("/").includes("..") || /vbaProject|\.bin$/i.test(name)) return false;
    names.add(name); totalInflated += inflated;
    if (totalInflated > 64 * 1024 * 1024 || view.getUint32(local, true) !== 0x04034b50 || view.getUint16(local + 8, true) !== method) return false;
    const localNameLength = view.getUint16(local + 26, true), localExtra = view.getUint16(local + 28, true);
    const data = local + 30 + localNameLength + localExtra;
    if (data + packed > start || decoder.decode(bytes.subarray(local + 30, local + 30 + localNameLength)) !== name) return false;
    if (wanted.has(name) || strictPreview) {
      const xmlEntry = /\.(xml|rels)$/i.test(name);
      const limit = wanted.has(name) || xmlEntry ? 2 * 1024 * 1024 : 8 * 1024 * 1024;
      if ((wanted.has(name) && !inflated) || inflated > limit || (strictPreview && totalInflated > 32 * 1024 * 1024)) return false;
      const source = bytes.subarray(data, data + packed);
      let content: Uint8Array;
      try { content = method === 0 ? source : inflateRawSync(source, {maxOutputLength: strictPreview ? Math.max(1, inflated) : 2 * 1024 * 1024}); } catch { return false; }
      if (content.length !== inflated || crc32(content) !== crc) return false;
      if (wanted.has(name) || xmlEntry) {
        const text = decoder.decode(content);
        if (/<!DOCTYPE|<!ENTITY/i.test(text)) return false;
        if (wanted.has(name)) xml.set(name, text);
      }
    }
    p = next;
  }
  if (p !== eocd || xml.size !== wanted.size) return false;
  const types = xmlRoot(xml.get("[Content_Types].xml")!, "Types", new Set([TYPES_NS]));
  const rels = xmlRoot(xml.get("_rels/.rels")!, "Relationships", new Set([RELS_NS]));
  const document = xmlRoot(xml.get("word/document.xml")!, "document", WORD_NS);
  return !!types && !!rels && !!document
    && children(types, "Override", TYPES_NS).some(node => node["@PartName"] === "/word/document.xml" && node["@ContentType"] === WORD + ".main+xml")
    && children(rels, "Relationship", RELS_NS).some(node => OFFICE_REL.has(String(node["@Type"])) && ["word/document.xml", "/word/document.xml"].includes(String(node["@Target"])) && node["@TargetMode"] !== "External");
}
/** CFB containers must contain an actual WordDocument stream, not just OLE magic. */
function legacyWord(bytes: Uint8Array): boolean {
  if (bytes.length < 1024) return false;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (view.getUint16(28, true) !== 0xfffe) return false;
  const shift = view.getUint16(30, true), major = view.getUint16(26, true);
  if (!((major === 3 && shift === 9) || (major === 4 && shift === 12))) return false;
  const sectorSize = 2 ** shift, count = bytes.length / sectorSize - 1;
  if (!Number.isInteger(count) || count < 1) return false;
  const sector = (id: number) => id < count ? bytes.subarray((id + 1) * sectorSize, (id + 2) * sectorSize) : null;
  const fatIds: number[] = [];
  for (let p = 76; p < 512; p += 4) { const id = view.getUint32(p, true); if (id < 0xfffffffa) fatIds.push(id); }
  let difat = view.getUint32(68, true), difatCount = view.getUint32(72, true);
  if (difatCount > 128) return false;
  const seenDifat = new Set<number>();
  while (difatCount--) {
    if (seenDifat.has(difat)) return false; seenDifat.add(difat);
    const data = sector(difat); if (!data) return false;
    const part = new DataView(data.buffer, data.byteOffset, data.byteLength);
    for (let p = 0; p < sectorSize - 4; p += 4) { const id = part.getUint32(p, true); if (id < 0xfffffffa) fatIds.push(id); }
    difat = part.getUint32(sectorSize - 4, true);
  }
  if (!fatIds.length || fatIds.length !== view.getUint32(44, true) || fatIds.some(id => !sector(id))) return false;
  const nextSector = (id: number) => {
    const fat = sector(fatIds[Math.floor(id / (sectorSize / 4))]);
    return fat ? new DataView(fat.buffer, fat.byteOffset, fat.byteLength).getUint32((id % (sectorSize / 4)) * 4, true) : 0xfffffffc;
  };
  let directory = view.getUint32(48, true), word = false, table = false;
  const seen = new Set<number>();
  while (directory !== 0xfffffffe) {
    if (seen.size > 128 || seen.has(directory)) return false;
    seen.add(directory); const data = sector(directory); if (!data) return false;
    const part = new DataView(data.buffer, data.byteOffset, data.byteLength);
    for (let p = 0; p < sectorSize; p += 128) {
      const length = part.getUint16(p + 64, true), type = data[p + 66];
      if (type !== 2 || length < 2 || length > 64 || length % 2) continue;
      const name = new TextDecoder("utf-16le").decode(data.subarray(p, p + length - 2));
      const streamSize = part.getUint32(p + 120, true), streamStart = part.getUint32(p + 116, true);
      if (streamSize > 0 && streamStart < count) {
        if (name === "WordDocument") word = true;
        if (name === "0Table" || name === "1Table") table = true;
      }
    }
    directory = nextSector(directory);
  }
  return word && table;
}
export function documentStructure(bytes: Uint8Array, type: string, strictPreview = false): boolean {
  try {
    if (type === WORD) return docx(bytes, strictPreview);
    if (type === "application/msword") return legacyWord(bytes);
    if (type === "application/pdf") {
      if (bytes.length < 80 || !/^%PDF-[12]\.[0-9]/.test(decoder.decode(bytes.subarray(0, 12)))) return false;
      const text = decoder.decode(bytes);
      const end = /startxref\s+(\d+)\s+%%EOF\s*$/.exec(text);
      if (!end) return false;
      const xref = Number(end[1]);
      if (!Number.isSafeInteger(xref) || xref < 8 || xref >= bytes.length) return false;
      const table = decoder.decode(bytes.subarray(xref, Math.min(bytes.length, xref + 2048)));
      const validXref = /^xref\s+\d+\s+\d+\b/.test(table)
        || (/^\d+\s+\d+\s+obj\b/.test(table) && /\/Type\s*\/XRef\b/.test(table));
      return validXref && /\d+\s+\d+\s+obj\b/.test(text)
        && (/\/Type\s*\/Catalog\b/.test(text) || /\/Type\s*\/ObjStm\b/.test(text));
    }
    return true;
  } catch { return false; }
}
