import { receiveUpload } from "@/lib/hiring/files";
import { getHiringEnv } from "@/lib/hiring/runtime";
export const dynamic="force-dynamic";
export async function POST(request:Request,context:{params:Promise<{token:string}>}){
  const {token}=await context.params,env=getHiringEnv();
  return receiveUpload(request,token,env.DB,env.BUCKET,env.APPLICATIONS_ENABLED==="true");
}
