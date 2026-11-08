import { countWords } from "../hiring/word-count";
import { sha256 } from "../hiring/crypto";
import type { ApplicationField, FieldSubmission } from "../hiring/types";

export type Submission = {id:string; name:string; email:string; fields_json:string; answers_json:string};
export type WrittenAnswer = {path:string; title:string; text:string; words:number; sanitized:string; prompt:string};

function array<T>(source:string):T[] {
  try { const value:unknown=JSON.parse(source); return Array.isArray(value)?value:[]; } catch { return []; }
}
export function writtenAnswers(row:Submission):WrittenAnswer[] {
  const fields=array<ApplicationField>(row.fields_json);
  const values=new Map(array<FieldSubmission>(row.answers_json).filter(Boolean).map(a=>[a.path,a.value]));
  const known = new Set([row.name,row.email]);
  for (const f of fields) {
    if (!f || !(f.path?.startsWith("_systemfield_") || ["Phone","Email","Url","SocialLink"].includes(f.type))) continue;
    const value=values.get(f.path);
    if (typeof value==="string" && value.trim().length>=3) known.add(value.trim());
  }
  const names=[...known].filter(Boolean).sort((a,b)=>b.length-a.length).map(value=>value.replace(/[.*+?^${}()|[\]\\]/g,"\\$&"));
  const personal=names.length?new RegExp("(?<![\\p{L}\\p{N}])(?:"+names.join("|")+")(?![\\p{L}\\p{N}])","giu"):null;
  const answers:WrittenAnswer[]=[];
  for(const f of fields){
    if (!f || !f.path || f.path.startsWith("_systemfield_") || !["String","LongText"].includes(f.type)) continue;
    const value=values.get(f.path);
    if(typeof value!=="string" || !value.trim())continue;
    const title=f.title||f.path;
    if (f.type==="String" && /^(?:(?:your|current|candidate|applicant|first|last|full|preferred)\s+)*(?:name|country(?: of residence)?|city|address|phone(?: number)?|email(?: address)?|employer|zip(?: code)?|postal code|referral code|linkedin(?: profile)?|portfolio(?: link)?)[?\s]*$/i.test(title.trim())) continue;
    const text=value.trim();
    let sanitized=text.replace(/\b(?:https?:\/\/|www\.)\S+/gi,"[link]").replace(/[^\s@]+@[^\s@]+\.[^\s@]+/g,"[email]")
      .replace(/(?:\+?\d[\s().-]*){9,}\d/g,"[number]");
    if(personal) sanitized=sanitized.replace(personal,"[redacted]");
    answers.push({path:f.path,title,text,words:countWords(text),sanitized,prompt:title+" "+(f.description||"")});
  }
  return answers;
}

export function canScan(answer:WrittenAnswer) {
  return answer.sanitized.length>=250 && countWords(answer.sanitized)>=100;
}
export function detectorHash(answer:WrittenAnswer) {
  return sha256("gptzero-v1\n"+answer.sanitized);
}
type Word = {value:string;index:number};
function words(text:string):Word[] {
  return Array.from(text.matchAll(/[\p{L}\p{N}]+/gu),match=>({value:match[0].normalize("NFKC").toLowerCase(),index:match.index}));
}
// Winnow 16-word shingles. The same contiguous 21-word sequence contains
// a common anchor even when the surrounding text or its position differs.
export async function passageAnchors(answer:WrittenAnswer) {
  const tokens=words(answer.sanitized);
  const prompt=" "+words(answer.prompt).map(word=>word.value).join(" ")+" ";
  const spans:{key:string;phrase:string;excerpt:string}[]=[];
  const seen=new Set<string>();
  const window:typeof spans=[];
  for (let i=0;i+16<=tokens.length;i++) {
    const group=tokens.slice(i,i+16), phrase=group.map(w=>w.value).join(" ");
    let hash=2166136261;
    for(let j=0;j<phrase.length;j++) hash=Math.imul(hash^phrase.charCodeAt(j),16777619);
    window.push({key:(hash>>>0).toString(16).padStart(8,"0"),phrase,excerpt:answer.sanitized.slice(group[0].index,tokens[i+16]?.index).trim().slice(0,350)});
    if(window.length>6)window.shift();
    if(window.length<6 && i+16<tokens.length)continue;
    const anchor=window.reduce((min,v)=>v.key<min.key?v:min);
    if(seen.has(anchor.phrase) || prompt.includes(" "+anchor.phrase+" ") || new Set(anchor.phrase.split(" ")).size<10)continue;
    seen.add(anchor.phrase);
    spans.push(anchor);
  }
  // Bound work for long essays, sampling by content so matching copies select
  // the same anchors. Verify identity with a cryptographic hash before display.
  return Promise.all(spans.sort((a,b)=>a.key.localeCompare(b.key)).slice(0,96).map(async span=>({
    hash:await sha256(span.phrase), excerpt:span.excerpt,
  })));
}
