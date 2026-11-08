import { dispatchInterviewMail, type CandidateMailResolver } from '../task-runner';
import { personalMailWorkspace, type PersonalMailEnv } from '../personal-mail/service';
import { submitInterviewInvitation } from './interview-submit';
import type { HubMember } from './auth';
import type { HubStore } from './store';
import type { ActionInput } from './validation';

export async function sendInterviewInvitation(store:HubStore, member:HubMember, applicationId:string, input:ActionInput, env:PersonalMailEnv, resolver?:CandidateMailResolver) {
  const detail = await submitInterviewInvitation(store, member, applicationId, input, env);
  // Look up this action's task by revision, even if another reviewer has since
  // opened or replaced the invitation. Never dispatch a different invitation.
  const prefix = `gmail:${applicationId}:interview:`;
  const suffix = `:invitation:${input.expectedRevision + 1}`;
  const unconfirmed = {status:'uncertain' as const, cc:[] as string[]};
  try {
    const task = await store.stmt(
      "SELECT id FROM hub_tasks WHERE application_id=? AND kind='gmail' AND instr(id,?)=1 AND substr(id,-length(?))=?",
      applicationId, prefix, suffix, suffix,
    ).first<{id:string}>();
    if (!task) return {...detail, interviewDelivery:unconfirmed};
    await dispatchInterviewMail(store,task.id,applicationId,(env.ADMIN_EMAILS||'').split(','),resolver||((account)=>personalMailWorkspace(store,account,env)));
    const current = await store.getApplication(applicationId, member.email);
    const row = await store.stmt('SELECT id FROM hub_communications WHERE task_id=?',task.id).first<{id:string}>();
    const message = current.communications.find(item=>item.id===row?.id);
    if (!message) return {...current,interviewDelivery:unconfirmed};
    const status = message.status==='pending' ? 'queued' : message.status;
    return {...current, interviewDelivery:{status,cc:message.cc||[]}};
  } catch {
    // An invitation was already committed. The leased outbox will retry or
    // reconcile it. Telling a recruiter to submit again could create a duplicate.
    return {...detail, interviewDelivery:unconfirmed};
  }
}
