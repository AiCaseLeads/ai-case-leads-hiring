const titles:Record<string,string>={application:'Application received',stage:'Hiring stage updated',assign:'Recruiter assignment updated',reject:'Application rejected',note:'Recruiter note added',email:'Email queued',scorecard:'Reviewer grade recorded',attendance:'Interview attendance updated',assessment:'Assessment updated',interview:'Interview updated',cancel_interview:'Interview cancelled',trash:'Application moved to Trash',restore:'Application restored',email_recovery:'Email retry queued'};
export function activitySummary(event:{type:string;text:string}):{title:string;description:string;review?:boolean}{
 if(event.type==='ai_match'){
  let data:Record<string,unknown>={};try{const parsed=JSON.parse(event.text);if(parsed&&typeof parsed==='object'&&!Array.isArray(parsed))data=parsed;}catch{/* Legacy malformed payload is not user-facing prose. */}
  const score=data.score;
  return typeof score==='number'&&Number.isFinite(score)&&score>=0&&score<=100
   ?{title:'AI review completed',description:`Job match: ${score} / 100.`,review:true}
   :{title:'AI review needs attention',description:'No job-match score was recorded. Open AI review for details.',review:true};
 }
 const title=titles[event.type]||'Hiring activity recorded';
 // Unknown/structured machine records must never spill JSON into the timeline.
 const description=/^\s*[\[{]/.test(event.text)?'Details recorded in the application.':event.text;
 return {title,description};
}
export function communicationSummary(status:string):{label:string;explanation:string}{
 const states:Record<string,{label:string;explanation:string}>={
 pending:{label:'Queued',explanation:'Waiting to send.'},running:{label:'Sending',explanation:'Sending is in progress.'},
 sent:{label:'Sent',explanation:'Accepted by the email service; inbox delivery is not confirmed here.'},
 delivered:{label:'Delivered',explanation:'Delivery was confirmed by the email service.'},
 failed:{label:'Failed',explanation:'The email could not be sent. Check delivery activity.'},
 uncertain:{label:'Confirmation pending',explanation:'The send outcome is not yet confirmed. Do not send a duplicate.'},
 cancelled:{label:'Cancelled',explanation:'This queued message was cancelled.'},
 };
 return states[status]||{label:'Status unavailable',explanation:'Delivery has not been confirmed.'};
}
