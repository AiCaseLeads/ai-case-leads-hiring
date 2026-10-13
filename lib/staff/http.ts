import type { HubStore } from "../hub/store";
import type { HubMember } from "../hub/auth-core";
import { HiringError } from "../hiring/errors";
import { assertSameOrigin,errorResponse,jsonResponse } from "../hiring/http";
import { boundedBytes } from "../hiring/files";
import { staffInput,staffTeam,updateStaff } from "./service";
export async function handleStaffTeam(request:Request,member:HubMember|null,store:HubStore,owners:string[]=[]){try{
 if(!member)throw new HiringError("staff_access_required",403,"Sign in with an authorized hiring account.");
 if(request.method==="GET")return jsonResponse({data:await staffTeam(store,member,owners)});
 if(!["POST","PATCH"].includes(request.method))throw new HiringError("method_not_allowed",405,"Use the team access form.");
 assertSameOrigin(request);
 let input;try{input=JSON.parse(new TextDecoder().decode(await boundedBytes(request,16000)));}catch{throw new HiringError("invalid_request",400,"The team member could not be read.");}
 const parsed=staffInput.safeParse(input);if(!parsed.success)throw new HiringError("invalid_staff_member",422,"Enter a valid email and recruiting role, then try again.");
 return jsonResponse({data:await updateStaff(store,member,owners,parsed.data,new URL(request.url).origin)});
}catch(error){return errorResponse(error);}}
