/** Stateful private-recovery endpoint for actual job-wizard browser fixtures. */
export async function installDraftFixture(page,{team=true}={}) {
 const drafts=new Map();
 await page.route("**/api/job-drafts**",async route=>{
  const req=route.request(),key=new URL(req.url()).searchParams.get("key");let data;
  if(req.method()==="GET")data=key?(drafts.get(key)||null):[...drafts.values()].map(({key,revision,updatedAt,state})=>({key,revision,updatedAt,title:state.title,startKind:state.startKind,sourceId:state.sourceId}));
  else{const input=req.postDataJSON();if(req.method()==="DELETE"){drafts.delete(input.key);data=true;}else{data={key:input.key,revision:(drafts.get(input.key)?.revision||0)+1,updatedAt:Date.now(),state:input.state};drafts.set(input.key,data);}}
  await route.fulfill({json:{data}});
 });
 if(team)await page.route("**/api/job-team**",route=>route.fulfill({json:{data:{config:null,staff:[],sender:"owner@example.invalid"}}}));
 return drafts;
}
