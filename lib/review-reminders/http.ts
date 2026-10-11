import type { HubStore } from "../hub/store";
import type { HubMember } from "../hub/auth-core";
import { HiringError } from "../hiring/errors";
import { assertSameOrigin,errorResponse,jsonResponse } from "../hiring/http";
import { boundedBytes } from "../hiring/files";
import { parse } from "../hub/validation";
import { CONFIG_KEY,activeStaff,configuration,configSchema,overdueQueue } from "./service";
export async function handleReviewReminders(request:Request,member:HubMember|null,store:HubStore,owners:string[]=[]){
  try{
    if(!member||!["admin","recruiter"].includes(member.role))throw new HiringError("staff_access_required",403,"Sign in with an authorized hiring team account.");
    if(request.method==="PATCH"){
      assertSameOrigin(request);
      if(member.role!=="admin")throw new HiringError("admin_access_required",403,"Only managers can change reminders.");
      let raw;try{raw=JSON.parse(new TextDecoder().decode(await boundedBytes(request,16000)));}catch{throw new HiringError("invalid_request",400,"The reminder settings could not be read.");}
      const input=parse(configSchema,raw),staff=await activeStaff(store,owners);
      if(input.fallbackAdmins.some(email=>!staff.some(s=>s.email===email&&s.role==="admin")))throw new HiringError("invalid_reminder_recipient",422,"Choose active managers for unassigned applications.");
      if(input.enabled&&!input.fallbackAdmins.length)throw new HiringError("reminder_fallback_required",422,"Choose at least one manager to review unassigned applications.");
      await store.setSetting(CONFIG_KEY,{...input,fallbackAdmins:[...new Set(input.fallbackAdmins)]});
    }else if(request.method!=="GET")throw new HiringError("method_not_allowed",405,"Use GET or PATCH.");
    const offset=Number(new URL(request.url).searchParams.get("offset")||0);
    if(!Number.isSafeInteger(offset)||offset<0||offset>1000000)throw new HiringError("invalid_offset",422,"Choose a valid queue page.");
    const scope=new URL(request.url).searchParams.get("scope")||"all";
    if(!["all","mine","unassigned"].includes(scope))throw new HiringError("invalid_scope",422,"Choose a valid queue filter.");
    const config=await configuration(store);
    return jsonResponse({data:{config,staff:await activeStaff(store,owners),...await overdueQueue(store,config,Date.now(),offset,scope==="mine"?member.email:scope==="unassigned"?"":undefined)}});
  }catch(error){return errorResponse(error);}
}
