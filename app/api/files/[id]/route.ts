import { requireHubMember } from "@/lib/hub/auth";
import { getHiringEnv } from "@/lib/hiring/runtime";
import { errorResponse } from "@/lib/hiring/http";
import { HiringError } from "@/lib/hiring/errors";
export const dynamic="force-dynamic";
export async function GET(request:Request,context:{params:Promise<{id:string}>}){
  try{
    await requireHubMember(request);
    const {id}=await context.params,env=getHiringEnv();
    if(!env.DB||!env.BUCKET)throw new HiringError("storage_unavailable",503,"File storage is unavailable.");
    const file=await env.DB.prepare("SELECT filename,content_type,object_key FROM hub_files WHERE id=? AND application_id IS NOT NULL AND uploaded_at>0").bind(id).first<{filename:string;content_type:string;object_key:string}>();
    if(!file)throw new HiringError("file_not_found",404,"This file is unavailable.");
    const object=await env.BUCKET.get(file.object_key);
    if(!object)throw new HiringError("file_not_found",404,"This file is unavailable.");
    return new Response(object.body,{headers:{"Content-Type":file.content_type,"Content-Disposition":`attachment; filename*=UTF-8''${encodeURIComponent(file.filename)}`,"Cache-Control":"private, no-store","X-Content-Type-Options":"nosniff","Referrer-Policy":"no-referrer"}});
  }catch(error){return errorResponse(error);}
}
