import type {HubStore} from '../hub/store';
import {configurationFingerprint} from '../google/config-state';
import {openToken} from '../google/oauth';
import {GoogleWorkspace} from '../google/workspace';
import {activeJobStaff} from '../job-team/service';
export const canConnectPersonalMail=(email:string)=>email.trim().toLowerCase()!=="sales@aicaseleads.com";
export const mailGrantKey=(email:string)=>`personal_mail_grant:${email.toLowerCase()}`;
export type PersonalMailGrant={email:string;sealedToken:string;revision:number;fingerprint:string;connectedAt:number};
export type PersonalMailEnv={GOOGLE_CLIENT_ID?:string;GOOGLE_CLIENT_SECRET?:string;GOOGLE_TOKEN_KEY?:string;GOOGLE_CLIENT_REVISION?:number;EXPECTED_RECRUITING_EMAIL?:string;ADMIN_EMAILS?:string};
export async function personalMailStatus(store:HubStore,email:string,env:PersonalMailEnv){
 const grant=await store.setting<PersonalMailGrant|null>(mailGrantKey(email),null);
 const configured=!!(env.GOOGLE_CLIENT_ID&&env.GOOGLE_CLIENT_SECRET&&env.GOOGLE_TOKEN_KEY);
 const connected=canConnectPersonalMail(email)&&configured&&!!grant&&grant.email===email.toLowerCase()&&grant.revision===(env.GOOGLE_CLIENT_REVISION??0)&&grant.fingerprint===await configurationFingerprint(env);
 return {email:email.toLowerCase(),configured,connected,canConnect:canConnectPersonalMail(email),connectedAt:connected?grant!.connectedAt:null};
}
/** Server-only connection. Never fall back to the company mailbox. */
export async function personalMailWorkspace(store:HubStore,email:string,env:PersonalMailEnv,fetcher:typeof fetch=fetch):Promise<GoogleWorkspace|null>{
 email=email.toLowerCase();
 if(!canConnectPersonalMail(email))return null;
 if(!(await activeJobStaff(store,(env.ADMIN_EMAILS||'').split(','))).some(person=>person.email===email))return null;
 if(!(await personalMailStatus(store,email,env)).connected)return null;
 const grant=await store.setting<PersonalMailGrant|null>(mailGrantKey(email),null);
 if(!grant)return null;
 return new GoogleWorkspace({clientId:env.GOOGLE_CLIENT_ID!,clientSecret:env.GOOGLE_CLIENT_SECRET!,refreshToken:await openToken(grant.sealedToken,env.GOOGLE_TOKEN_KEY!),sender:email},fetcher);
}
