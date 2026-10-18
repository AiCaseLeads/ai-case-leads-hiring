import { requireHubMember } from "@/lib/hub/auth";
import { getHiringEnv } from "@/lib/hiring/runtime";
import { errorResponse } from "@/lib/hiring/http";
import { privateApplicationFile } from "@/lib/hub/files";
export const dynamic="force-dynamic";
export async function GET(request:Request,context:{params:Promise<{id:string}>}){
  try{
    const member=await requireHubMember(request);
    const {id}=await context.params,env=getHiringEnv();
    return await privateApplicationFile(request,id,member,env.DB,env.BUCKET);
  }catch(error){return errorResponse(error);}
}

export async function HEAD(request:Request,context:{params:Promise<{id:string}>}) {
  const response=await GET(request,context);
  await response.body?.cancel();
  return new Response(null,{status:response.status,headers:response.headers});
}
