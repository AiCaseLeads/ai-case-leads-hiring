import { contactPaths } from "./contact-fields";

type Field = {path:string;type:string};
export function isWrittenResponse(field:Field) {
  return field.type==="LongText" || (field.type==="String" && !contactPaths.includes(field.path));
}

/** Client-reported observations. Never an authenticated measure of ability or authorship. */
export type ResponseEntryField = {path:string;pasteAttempts:number;largeInsertions:number;largestInsertionChars:number};
export type ResponseEntry = {version:1;formElapsedMs:number|null;firstEditToSubmitMs:number|null;fields:ResponseEntryField[]};

const MIN_LARGE_INSERT = 80;
const MAX_FIELD_CHARS = 20000;
const MAX_EVENTS = 65535;
const MAX_ELAPSED_MS = 30*24*60*60*1000;
const elapsed = (start:number|null,end:number) => {
  if (start===null) return null;
  const ms=Math.round(end-start);
  return Number.isSafeInteger(ms) && ms>=0 && ms<=MAX_ELAPSED_MS ? ms : null;
};

export class ResponseEntryCounter {
  private readonly observed = new Map<string,ResponseEntryField>();
  private firstEdit:number|null=null;
  private lastPaste:{path:string;phase:number;at:number}|null=null;
  constructor(private readonly opened:number) {}

  private field(path:string) {
    let row=this.observed.get(path);
    if (!row) {
      row={path,pasteAttempts:0,largeInsertions:0,largestInsertionChars:0};
      this.observed.set(path,row);
    }
    return row;
  }
  paste(path:string,event:"paste"|"beforeinput"|"input",at:number) {
    // One paste can produce paste → beforeinput → input. Count the gesture once.
    const phase=event==="paste"?0:event==="beforeinput"?1:2;
    const previous=this.lastPaste;
    if (!previous || previous.path!==path || phase<=previous.phase || at-previous.at>150) {
      const row=this.field(path);
      row.pasteAttempts=Math.min(MAX_EVENTS,row.pasteAttempts+1);
    }
    this.lastPaste={path,phase,at};
  }
  edit(path:string,insertedChars:number,at:number) {
    this.firstEdit??=at;
    this.lastPaste=null;
    if (insertedChars<MIN_LARGE_INSERT) return;
    const row=this.field(path);
    row.largeInsertions=Math.min(MAX_EVENTS,row.largeInsertions+1);
    row.largestInsertionChars=Math.max(row.largestInsertionChars,Math.min(insertedChars,MAX_FIELD_CHARS));
  }
  snapshot(submitted:number):ResponseEntry {
    return {version:1,formElapsedMs:elapsed(this.opened,submitted),firstEditToSubmitMs:elapsed(this.firstEdit,submitted),
      fields:[...this.observed.values()].map(row=>({...row}))};
  }
}

const object = (value:unknown):value is Record<string,unknown> => value!==null && typeof value==="object" && !Array.isArray(value);
const integer = (value:unknown,max:number):value is number => typeof value==="number" && Number.isSafeInteger(value) && value>=0 && value<=max;
const timing = (value:unknown):value is number|null => value===null || integer(value,MAX_ELAPSED_MS);

/** Invalid optional metadata is dropped. It must never prevent accepting an otherwise valid application. */
export function parseResponseEntry(value:unknown,definition?:readonly Field[]):ResponseEntry|null {
  if (!object(value) || value.version!==1 || !timing(value.formElapsedMs) || !timing(value.firstEditToSubmitMs) ||
    (value.formElapsedMs!==null && value.firstEditToSubmitMs!==null && value.firstEditToSubmitMs>value.formElapsedMs) ||
    !Array.isArray(value.fields) || value.fields.length>103) return null;
  const allowed=definition && new Set(definition.filter(isWrittenResponse).map(field=>field.path));
  const rows:ResponseEntryField[]=[];
  const seen=new Set<string>();
  for (const field of value.fields) {
    if (!object(field) || typeof field.path!=="string" || !field.path || field.path.length>256 || seen.has(field.path) ||
      !integer(field.pasteAttempts,MAX_EVENTS) || !integer(field.largeInsertions,MAX_EVENTS) || !integer(field.largestInsertionChars,MAX_FIELD_CHARS) ||
      (field.largeInsertions>0 ? field.largestInsertionChars<MIN_LARGE_INSERT : field.largestInsertionChars!==0)) return null;
    seen.add(field.path);
    if (allowed && !allowed.has(field.path)) continue;
    rows.push({path:field.path,pasteAttempts:field.pasteAttempts,largeInsertions:field.largeInsertions,largestInsertionChars:field.largestInsertionChars});
  }
  return {version:1,formElapsedMs:value.formElapsedMs,firstEditToSubmitMs:value.firstEditToSubmitMs,fields:rows};
}
