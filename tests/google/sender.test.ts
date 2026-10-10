import test from "node:test";
import assert from "node:assert/strict";
import {expectedRecruitingSender,assertRecruitingSender} from "../../lib/google/sender";
test("only the chosen recruiting account may become the sender",()=>{
 assert.equal(expectedRecruitingSender(),"mariam@aicaseleads.com");
 assert.doesNotThrow(()=>assertRecruitingSender("MARIAM@aicaseleads.com"));
 assert.throws(()=>assertRecruitingSender("another@example.invalid"),{code:"wrong_sender"});
 assert.equal(expectedRecruitingSender({EXPECTED_RECRUITING_EMAIL:" other@example.invalid "}),"other@example.invalid");
 assert.throws(()=>expectedRecruitingSender({EXPECTED_RECRUITING_EMAIL:"invalid"}),{code:"invalid_recruiting_sender"});
});

