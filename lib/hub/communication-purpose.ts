/** Purpose comes from application-scoped durable task IDs, never editable email subjects. */
export function communicationPurpose(taskId:string,applicationId:string):string{
 const prefix=`gmail:${applicationId}:`;
 if(!taskId.startsWith(prefix))return 'Email';
 const kind=taskId.slice(prefix.length).split(':')[0];
 return ({confirmation:'Acknowledgment email',rejection:'Rejection email',assessment:'Assessment invitation',interview:'Interview invitation',reminder:'Interview reminder',manual:'Recruiter email'} as Record<string,string>)[kind]||'Email';
}
