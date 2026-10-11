import { z } from "zod";
export const criterionSchema=z.object({label:z.string().trim().min(1).max(180),weight:z.number().int().min(1).max(10),anchors:z.tuple([z.string().trim().min(1).max(200),z.string().trim().min(1).max(200),z.string().trim().min(1).max(200),z.string().trim().min(1).max(200),z.string().trim().min(1).max(200)])}).strict();
export const rubricSchema=z.object({name:z.string().trim().min(1).max(120),criteria:z.array(criterionSchema).min(1).max(8)}).strict().refine(x=>new Set(x.criteria.map(c=>c.label.toLowerCase())).size===x.criteria.length,"Use distinct criterion names.");
export type Rubric=z.infer<typeof rubricSchema>;
export type Template=Rubric&{id:string;version:number;createdBy:string;createdAt:number};
export type Binding={templateId:string;version:number};
export type Catalog={revision:number;templates:Template[];archived:string[];bindings:Record<string,Binding>;updatedBy?:string;updatedAt?:number};
export const emptyCatalog:Catalog={revision:0,templates:[],archived:[],bindings:{}};
export const configInput=z.discriminatedUnion("action",[
 z.object({action:z.literal("save"),expectedRevision:z.number().int().min(0),templateId:z.string().uuid().optional(),rubric:rubricSchema}).strict(),
 z.object({action:z.literal("archive"),expectedRevision:z.number().int().min(0),templateId:z.string().uuid()}).strict(),
 z.object({action:z.literal("bind"),expectedRevision:z.number().int().min(0),jobId:z.string().min(1).max(128),templateId:z.string().uuid().nullable(),version:z.number().int().positive().optional()}).strict(),
]);
export const ratingsSchema=z.array(z.object({score:z.number().int().min(1).max(5),evidence:z.string().trim().min(1).max(750)}).strict()).min(1).max(8);
export const reviewInput=z.object({applicationId:z.string().min(1).max(128),expectedRevision:z.number().int().positive(),templateId:z.string().uuid(),version:z.number().int().positive(),ratings:ratingsSchema}).strict();
export type Rating=z.infer<typeof ratingsSchema>[number];
export function calculateScore(template:Template,ratings:Rating[]){
 if(ratings.length!==template.criteria.length)throw new Error("Every criterion needs one rating.");
 const exact=ratings.reduce((sum,item,i)=>sum+item.score*template.criteria[i].weight,0)/template.criteria.reduce((sum,c)=>sum+c.weight,0);
 return {exact,overall:exact};
}
export function snapshotText(template:Template,ratings:Rating[]){
 const grade=calculateScore(template,ratings);
 return [`Reusable scorecard: ${template.name} (version ${template.version}, ${template.id})`,`Weighted mean: ${grade.exact.toFixed(4)}/5. Overall grade: ${grade.overall}/5 (unrounded mean).`,...template.criteria.map((c,i)=>`${i+1}. ${c.label} — weight ${c.weight}; score ${ratings[i].score}/5\nAnchors: ${c.anchors.map((a,n)=>`${n+1}: ${a}`).join(" | ")}\nEvidence: ${ratings[i].evidence}`)].join("\n\n");
}
export function boundTemplate(catalog:Catalog,jobId:string){const binding=catalog.bindings[jobId];return binding?catalog.templates.find(t=>t.id===binding.templateId&&t.version===binding.version):undefined;}
