"use client";
import { acceptedEnglishLevels, englishMinimum, englishOptions } from "@/lib/english-proficiency";
import type { ApplicationField } from "@/lib/hiring/types";
import type { Rule } from "./types";
import { Field } from "./shared";
export function EnglishScreening({field,rules,change}:{field:ApplicationField;rules:Rule[];change:(rules:Rule[])=>void}) {
 const rule=rules.find(rule=>rule.fieldPath===field.path&&rule.enabled);
 const minimum=rule?.operator==="in"?englishMinimum(rule.value):"";
 return <section className="hub-screening-question" aria-label="English proficiency screening"><Field label="Minimum English level"><select value={minimum} onChange={event=>{const rest=rules.filter(rule=>rule.fieldPath!==field.path);change(event.target.value?[...rest,{fieldPath:field.path,operator:"in",value:acceptedEnglishLevels(event.target.value),enabled:true,reason:`English proficiency must be ${event.target.value} or higher.`}]:rest);}}><option value="">No minimum — no English screening</option>{englishOptions.map(option=><option key={option.value} value={option.value}>{option.label}</option>)}</select></Field><p className="hub-muted">{minimum?`${minimum} or higher meets this requirement. `:""}C2 is the highest CEFR level. The applicant reports their own level.</p></section>;
}
