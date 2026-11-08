import assert from "node:assert/strict";
import { test } from "node:test";
import type { ApplicationField, ApplicationInput } from "../../lib/hiring/types";
import { HiringError } from "../../lib/hiring/errors";
import { validateAnswers } from "../../lib/hiring/validation";
import { countWords } from "../../lib/hiring/word-count";
import { jobInput, validateJob } from "../../lib/hub/validation";

const field: ApplicationField = {
  path: "example",
  title: "Describe your campaign",
  type: "LongText",
  required: true,
  minWords: 10,
};
function application(value?: string): ApplicationInput {
  return {
    jobPostingId: "test",
    submissionKey: "test",
    fieldSubmissions: value === undefined ? [] : [{ path: field.path, value }],
  };
}

test("written minimum blocks short submissions with a field error and accepts the boundary", () => {
  for (const answer of ["Yes", "My answer has nine words about how campaigns work!", "Yes ... ... ... ... ... ... ... ... ..."]) {
    assert.throws(() => validateAnswers(application(answer), [field]), error =>
      error instanceof HiringError && error.code === "invalid_application" && error.fieldErrors?.example === "Write at least 10 words.");
  }
  validateAnswers(application("First I check whether the conversion tracking still works correctly."), [field]);
  assert.equal(countWords("  We're\nchecking cost-per-lead, résumé quality & Español. "), 6);
});

test("optional written questions may be omitted, and legacy fields accept short answers", () => {
  validateAnswers(application(), [{ ...field, required: false }]);
  validateAnswers(application(""), [{ ...field, required: false }]);
  validateAnswers(application("  \n  "), [{ ...field, required: false }]);
  validateAnswers(application("Yes"), [{ ...field, minWords: undefined }]);
  assert.throws(() => validateAnswers(application(), [field]), { code: "invalid_application" });
});

test("job configuration permits a bounded whole-word minimum only on written questions", () => {
  const job = {title:"Role",slug:"role",descriptionHtml:"<p>About the role</p>",status:"draft",department:"",rules:[],autoReject:false,fields:[field]};
  validateJob(jobInput.parse(job));
  for (const minWords of [0, -1, 1.5, 1001]) {
    assert.equal(jobInput.safeParse({...job,fields:[{...field,minWords}]}).success,false);
  }
  assert.throws(() => validateJob(jobInput.parse({...job,fields:[{...field,type:"Boolean"}]})),{code:"invalid_job"});
});

test("written answers can reach their minimum without spaces in Chinese, Japanese and Thai", () => {
  for (const sentence of ["我喜欢学习中文", "今日は良い天気です", "ฉันรักการเขียนโปรแกรม"]) {
    validateAnswers(application(sentence), [{ ...field, minWords: 3 }]);
  }
});
