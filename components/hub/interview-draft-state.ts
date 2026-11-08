/** Refresh untouched defaults; preserve the author's one-off email edits. */
export function refreshedInterviewDraft<T extends {subject:string;body:string;version:number}>(draft:{subject:string;body:string},latest:T,edited=true){return {...(edited?draft:{subject:latest.subject,body:latest.body}),templateVersion:latest.version};}
export function defaultInterviewOrganizer(current:string,renew:boolean,email:string|undefined,people:{email:string;ready:boolean}[]){return !current&&!renew&&email&&people.some(person=>person.email===email&&person.ready)?email:current;}
export function interviewCancelOutcome({busy,dirty,confirming}:{busy:boolean;dirty:boolean;confirming:boolean}):'none'|'keep'|'ask'|'discard'{return busy?'none':confirming?'keep':dirty?'ask':'discard';}
/** A delayed preview may never restore a draft after it changed or was closed. */
export class InterviewPreviewEpoch {private generation=0;private mounted=true;begin(){return ++this.generation}invalidate(){this.generation++}mount(){this.mounted=true}dispose(){this.mounted=false;this.invalidate()}accept(ticket:number){return this.mounted&&ticket===this.generation}}

export function interviewPreviewRecovery(code:string|undefined){return code==="template_changed"?"template":code==="preview_changed"?"preview":null;}

export function interviewNavigationOutcome(open:boolean,dirty:boolean,busy=false){return open&&busy?"blocked":!dirty?"leave":open?"modal":"page";}

export function canPreviewInterview(busy:boolean,hasTemplate:boolean,templateStale:boolean){return !busy&&hasTemplate&&!templateStale;}
