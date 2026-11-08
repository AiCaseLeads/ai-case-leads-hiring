import type {HubStore} from '../hub/store';
import {HiringError} from '../hiring/errors';
import {activeJobStaff} from '../job-team/service';
import {canConnectPersonalMail,personalMailWorkspace,type PersonalMailEnv} from './service';

/** Operator-only self-test. No HTTP/MCP surface, applicant recipient or applicant writes.
 * A deterministic Message-ID lets Gmail reconcile a previously accepted send.
 * Uncertain outcomes propagate; the caller must reconcile rather than retry blindly. */
export async function sendOwnerMailTest(store:HubStore,email:string,testId:string,env:PersonalMailEnv,fetcher:typeof fetch=fetch){
 const recipient=typeof email==='string'?email.trim().toLowerCase():'';
 const owners=(env.ADMIN_EMAILS||'').split(',').map(value=>value.trim().toLowerCase()).filter(Boolean);
 if(!canConnectPersonalMail(recipient)||!owners.includes(recipient)||!(await activeJobStaff(store,owners)).some(person=>person.email===recipient))throw new HiringError('owner_mail_test_not_allowed',403,'The connection test can only email an authorized account owner.');
 if(typeof testId!=='string'||!/^[a-z0-9-]{1,80}$/.test(testId))throw new HiringError('invalid_owner_mail_test_id',422,'Use a test identifier containing 1 to 80 lowercase letters, numbers or hyphens.');
 const workspace=await personalMailWorkspace(store,recipient,env,fetcher);
 if(!workspace)throw new HiringError('owner_mail_connection_required',422,'Connect this owner’s personal recruiting email before running the connection test.');
 workspace.setDeadline(Date.now()+20000);
 const profile=await workspace.profile();
 if(profile.email.trim().toLowerCase()!==recipient)throw new HiringError('owner_mail_identity_mismatch',403,'The connected Gmail account does not match the selected owner.');
 const messageId=`qa-owner-test-${testId}@jobs.aicaseleads.com`;
 const sent=await workspace.sendMail({to:recipient,sender:recipient,cc:[recipient],replyTo:[recipient],candidateMail:true,candidateAccount:recipient,messageId,subject:`Hiring email connection test – ${testId}`,body:'This is a hiring email connection test sent only to your own account. No applicant was contacted.\n\nThis verifies the connected Gmail sender and reply address. This is not an interview invitation and contains no booking link.'});
 // The MIME builder deduplicates the self-copy recipient already in To. No other
 // address is accepted or included in this diagnostic envelope.
 return {recipient,messageId,sentMessageId:sent.id,threadId:sent.threadId};
}
