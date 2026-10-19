import assert from "node:assert/strict";
import { test } from "node:test";
import { contactPaths, withRequiredContacts } from "../../lib/hiring/contact-fields";
import { reorderApplicationQuestions } from "../../lib/job-setup/question-order";
import type { ApplicationField } from "../../lib/hiring/types";

const questions: ApplicationField[] = [
  { path: "years", title: "Years of experience", type: "Number", required: true },
  { path: "portfolio", title: "Portfolio", type: "Url", required: false, description: "Original instructions" },
  { path: "briefs", title: "Briefs completed", type: "Number", required: true },
  { path: "availability", title: "Availability", type: "ValueSelect", required: true, options: [{ value: "now", label: "Immediately" }] },
];

test("question drag moves by stable answer key without altering contacts or question contents", () => {
  const fields = withRequiredContacts(questions);
  const before = structuredClone(fields);
  const next = reorderApplicationQuestions(fields, "availability", "years");
  assert.deepEqual(next.map(field => field.path), [...contactPaths, "availability", "years", "portfolio", "briefs"]);
  assert.deepEqual(fields, before, "source arrays and nested choices stay unchanged");
  next.forEach(field => assert.equal(field, fields.find(original => original.path === field.path), "preserve field identity and every saved property"));
  assert.deepEqual(reorderApplicationQuestions(next, "availability", "briefs"), fields);
});

test("invalid or cancelled targets and fixed contacts cannot change the order", () => {
  const fields = withRequiredContacts(questions);
  for (const [active, target] of [["years", "years"], ["missing", "briefs"], ["years", "missing"], [contactPaths[0], "years"], ["years", contactPaths[3]]]) {
    assert.equal(reorderApplicationQuestions(fields, active, target), fields);
  }
});

test("legacy fixed contacts remain in their original slots even when interspersed", () => {
  const fields = [questions[0], ...withRequiredContacts([]).slice(0, 2), questions[1], ...withRequiredContacts([]).slice(2), questions[2]];
  const next = reorderApplicationQuestions(fields, "briefs", "years");
  assert.deepEqual(next.filter(field => !contactPaths.includes(field.path)).map(field => field.path), ["briefs", "years", "portfolio"]);
  fields.forEach((field, index) => { if (contactPaths.includes(field.path)) assert.equal(next[index], field); });
});

test('hidden resume and legacy LinkedIn slots survive custom reordering unchanged',()=>{
 const resume:ApplicationField={path:'_systemfield_resume',title:'Résumé',type:'File',required:true};
 const linkedin:ApplicationField={path:'professional_linkedin',title:'LinkedIn profile',type:'SocialLink',required:true};
 const fields=[questions[0],resume,questions[1],linkedin,questions[2]];
 const next=reorderApplicationQuestions(fields,'briefs','years');
 assert.equal(next[1],resume);assert.equal(next[3],linkedin);
 assert.deepEqual(next.filter(f=>f!==resume&&f!==linkedin).map(f=>f.path),['briefs','years','portfolio']);
 assert.equal(reorderApplicationQuestions(fields,resume.path,'years'),fields);
 assert.equal(reorderApplicationQuestions(fields,'years',linkedin.path),fields);
});
