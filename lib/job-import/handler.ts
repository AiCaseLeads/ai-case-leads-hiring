import { importInput, generateDraft, draftJobs, publishJobs } from './service';
import { boundedBytes } from '../hiring/files';
import { jsonResponse } from '../hiring/http';
import { HiringError } from '../hiring/errors';
import type { HubStore } from '../hub/store';
export async function readBody(request:Request){const bytes=await boundedBytes(request,256*1024);try{return JSON.parse(new TextDecoder().decode(bytes));}catch{throw new HiringError('invalid_request',400,'Provide valid JSON.');}}
export async function handleImport(request:Request,store:HubStore,key?:string){
 const i=importInput.parse(await readBody(request));const draft=i.mode==='structured'?JSON.parse(i.text):await generateDraft(store,i.text,key);return jsonResponse({data:{draft,jobs:draftJobs(draft,i.countries,i.countryMode),requiresReview:true}});
}
export async function handlePublish(request:Request,store:HubStore){const i=await readBody(request);return jsonResponse({data:await publishJobs(store,i.jobs,i.confirm===true)});}
