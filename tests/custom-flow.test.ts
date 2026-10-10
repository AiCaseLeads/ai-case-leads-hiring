import test from "node:test";
import assert from "node:assert/strict";
import { customDatabase,openSyntheticRole } from "./custom-fixture";
import { acceptLocalApplication } from "../lib/hiring/local";
import { sha256 } from "../lib/hiring/crypto";
import type { ApplicationInput } from "../lib/hiring/types";
const session="a".repeat(64);
function input(jobId:string):ApplicationInput{return{jobPostingId:jobId,submissionKey:crypto.randomUUID(),fieldSubmissions:[{path:"_systemfield_name",value:"Synthetic Applicant"},{path:"_systemfield_email",value:"synthetic@example.invalid"}]};}
test("local acceptance, receipt and Google tasks commit together without network access",async()=>{
  const {database,db,store}=customDatabase();try{
    const role=await openSyntheticRole(store),application=input(role.id);
    const result=await acceptLocalApplication(db,application,session,true);
    assert.equal(result.status,"accepted");assert.ok(result.receipt);
    const tracker=database.prepare("SELECT * FROM hiring_submissions WHERE key_hash=?").get(await sha256(application.submissionKey));
    assert.equal(tracker?.status,"accepted");
    assert.equal(database.prepare("SELECT COUNT(*) AS n FROM hub_applications").get()?.n,1);
    assert.equal(database.prepare("SELECT COUNT(*) AS n FROM hub_tasks").get()?.n,2);
    assert.equal(database.prepare("SELECT COUNT(*) AS n FROM hub_communications").get()?.n,1);
    const repeat=await acceptLocalApplication(db,application,session,false);
    assert.equal(repeat.status,"accepted");
    assert.equal(database.prepare("SELECT COUNT(*) AS n FROM hub_applications").get()?.n,1);
    assert.equal(database.prepare("SELECT COUNT(*) AS n FROM hub_tasks").get()?.n,2);
    await assert.rejects(()=>acceptLocalApplication(db,{...application,fieldSubmissions:[{path:"_systemfield_name",value:"Changed"},{path:"_systemfield_email",value:"synthetic@example.invalid"}]},session,true),/different answers/);
    await assert.rejects(()=>acceptLocalApplication(db,application,"b".repeat(64),true),/another browser/);
  }finally{database.close();}
});
test("failed transactional tracking leaves no candidate or external task",async()=>{
  const {database,db,store}=customDatabase();try{
    const role=await openSyntheticRole(store);
    database.exec("CREATE TRIGGER test_tracking_failure BEFORE INSERT ON hiring_submissions BEGIN SELECT RAISE(ABORT,'synthetic tracking failure'); END");
    await assert.rejects(()=>acceptLocalApplication(db,input(role.id),session,true));
    assert.equal(database.prepare("SELECT COUNT(*) AS n FROM hub_applications").get()?.n,0);
    assert.equal(database.prepare("SELECT COUNT(*) AS n FROM hub_tasks").get()?.n,0);
    assert.equal(database.prepare("SELECT COUNT(*) AS n FROM hub_history").get()?.n,0);
  }finally{database.close();}
});
test("closed intake and closed roles create no hiring records",async()=>{
  const {database,db,store}=customDatabase();try{
    const role=await openSyntheticRole(store);
    await assert.rejects(()=>acceptLocalApplication(db,input(role.id),session,false),/not open/);
    await store.saveJob({...role,status:"closed"},role.id);
    await assert.rejects(()=>acceptLocalApplication(db,input(role.id),session,true),/no longer/);
    assert.equal(database.prepare("SELECT COUNT(*) AS n FROM hub_applications").get()?.n,0);
  }finally{database.close();}
});
test("production acceptance requires the displayed form version and retains accepted replay after edits",async()=>{
  const {database,db,store}=customDatabase();try{
    const role=await openSyntheticRole(store),application={...input(role.id),formVersion:role.formVersion};
    await assert.rejects(()=>acceptLocalApplication(db,input(role.id),session,true,true),/questions changed/);
    const saved=await acceptLocalApplication(db,application,session,true,true);
    assert.equal(saved.status,"accepted");
    await store.saveJob({...role,descriptionHtml:"<p>Changed synthetic description.</p>"},role.id);
    await assert.rejects(()=>acceptLocalApplication(db,{...application,submissionKey:crypto.randomUUID()},session,true,true),/questions changed/);
    const replay=await acceptLocalApplication(db,application,session,false,true);
    assert.equal(replay.status,"accepted");
    assert.equal(database.prepare("SELECT COUNT(*) AS n FROM hub_applications").get()?.n,1);
    assert.equal(database.prepare("SELECT COUNT(*) AS n FROM hiring_submissions").get()?.n,1);
  }finally{database.close();}
});
