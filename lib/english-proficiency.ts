import type { ApplicationField } from "./hiring/types";
export const englishProficiencyPath = "english_proficiency_cefr";
export const englishLevels = ["A1", "A2", "B1", "B2", "C1", "C2"] as const;
export const englishOptions = englishLevels.map((value,index)=>({value,label:`${value} — ${["Beginner","Elementary","Intermediate","Upper intermediate","Advanced","Proficient"][index]}`}));
export function englishProficiencyField(): ApplicationField {return {path:englishProficiencyPath,title:"English proficiency",type:"ValueSelect",required:true,description:"Self-assess your current English level using the CEFR scale. C2 is the highest level; no certificate is required.",options:englishOptions.map(option=>({...option}))};}
export function isEnglishProficiency(field:{path:string;type:string}) {return field.path===englishProficiencyPath && field.type==="ValueSelect";}
export function acceptedEnglishLevels(minimum:string) {const index=englishLevels.findIndex(level=>level===minimum);return index<0?[]:englishLevels.slice(index);}
export function englishMinimum(value:unknown):string {if(!Array.isArray(value))return "";return englishLevels.find(level=>{const accepted=acceptedEnglishLevels(level);return value.length===accepted.length&&accepted.every(code=>value.includes(code));})||"";}
