import test from "node:test";
import assert from "node:assert/strict";
import { gradeForScorecards } from "../../lib/hub/grading";
const card=(actor:string,score:number,createdAt:number,id="")=>({actor,score,createdAt,id,criteria:"Overall fit against the posted requirements",text:"Resume and assessment evidence reviewed."});
test("missing reviews remain ungraded rather than zero or top-ranked",()=>{
 const grade=gradeForScorecards([]);
 assert.equal(grade.reviewed,false);assert.equal(grade.averageScore,null);assert.equal(grade.scorePercent,null);assert.equal(grade.reviewerCount,0);
});
test("reviewer edits replace that review instead of inflating influence",()=>{
 const grade=gradeForScorecards([card("Manager@Example.invalid",5,1),card(" manager@example.invalid ",2,3),card("second@example.invalid",4,2)]);
 assert.equal(grade.reviewerCount,2);assert.equal(grade.scorecardCount,3);assert.equal(grade.averageScore,3);assert.equal(grade.scorePercent,60);
 assert.equal(grade.latestReviews.find(c=>c.actor==="manager@example.invalid")?.score,2);
});
test("equal-time review ties are deterministic and invalid grades never rank",()=>{
 const cards=[card("reviewer@example.invalid",4,2,"a"),card("reviewer@example.invalid",5,2,"b"),card("invalid@example.invalid",100,3)];
 assert.deepEqual(gradeForScorecards(cards),gradeForScorecards([...cards].reverse()));
 assert.equal(gradeForScorecards(cards).averageScore,5);assert.equal(gradeForScorecards(cards).reviewerCount,1);
});
test("low valid grade is still graded and carries review evidence",()=>{
 const grade=gradeForScorecards([card("reviewer@example.invalid",1,2)]);
 assert.equal(grade.reviewed,true);assert.equal(grade.scorePercent,20);assert.match(grade.latestReviews[0].text,/evidence/);
});

