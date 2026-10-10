export class DeadlineError extends Error {
  constructor(public readonly code="operation_deadline_exceeded") {super("The operation exceeded its processing deadline.");}
}
/**
 * Bounds the caller's wait for APIs without AbortSignal. The underlying operation
 * may finish later, so mutations must use immutable/idempotent keys and retain
 * their recovery metadata until a subsequent read confirms completion.
 */
export async function withinDeadline<T>(operation:()=>Promise<T>,deadline:number,code="operation_deadline_exceeded"):Promise<T>{
 const remaining=deadline-Date.now();
 if(!Number.isFinite(remaining)||remaining<=0)throw new DeadlineError(code);
 let timer:ReturnType<typeof setTimeout>|undefined;
 try{
  return await Promise.race([
   Promise.resolve().then(operation),
   new Promise<never>((_resolve,reject)=>{timer=setTimeout(()=>reject(new DeadlineError(code)),Math.min(remaining,2147483647));})
  ]);
 }finally{if(timer!==undefined)clearTimeout(timer);}
}

