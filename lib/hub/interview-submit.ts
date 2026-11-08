import type {HubStore} from './store';import type {HubMember} from './auth';import type {ActionInput} from './validation';import type {PersonalMailEnv} from '../personal-mail/service';import {interviewReadiness,assertInterviewReady} from './interview-readiness';import {HiringError} from '../hiring/errors';
export async function submitInterviewInvitation(store:HubStore,member:HubMember,applicationId:string,input:ActionInput,env:PersonalMailEnv){
 if(input.action!=='interview'||!input.templateVersion||!input.previewFingerprint)throw new HiringError('preview_required',422,'Preview the invitation before sending.');
 assertInterviewReady(await interviewReadiness(store,member,applicationId,env,input),input);
 return store.action(applicationId,input,member);
}
