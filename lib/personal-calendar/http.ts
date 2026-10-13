import type { HubMember } from "../hub/auth-core";
import type { HubStore } from "../hub/store";
import { activeJobStaff } from "../job-team/service";
import { assertSameOrigin,errorResponse,jsonResponse } from "../hiring/http";
import { HiringError } from "../hiring/errors";
import { boundedBytes } from "../hiring/files";
import { availabilityKey,availabilitySchema,personalStatus } from "./service";
export async function handlePersonalCalendar(request:Request,member:HubMember|null,store:HubStore,owners:string[]=[],configured=true){
 try{
  if(!member)throw new HiringError("staff_access_required",403,"Sign in to set up your calendar.");
  if(request.method==="PUT"){
   assertSameOrigin(request);
   const body=JSON.parse(new TextDecoder().decode(await boundedBytes(request,8192)));
   const parsed=availabilitySchema.safeParse(body.availability);
   if(!parsed.success)throw new HiringError("invalid_availability",422,"Check your time zone, working days, start/end hours, and interview length.");
   await store.setSetting(availabilityKey(member.email),parsed.data);
  }else if(request.method!=="GET")throw new HiringError("method_not_allowed",405,"Method not allowed.");
  const staff=await activeJobStaff(store,[...owners,member.email]);
  const interviewers=await Promise.all(staff.map(async person=>{const status=await personalStatus(store,person.email);return {email:status.email,connected:status.connected,ready:status.ready};}));
  return jsonResponse({data:{...await personalStatus(store,member.email),configured,interviewers}});
 }catch(error){return errorResponse(error);}
}
