import { contactPaths, resumePath, isLinkedInProfile } from "../hiring/contact-fields";
import type { ApplicationField } from "../hiring/types";

export function isFixedApplicationField(field: ApplicationField): boolean {
  return contactPaths.includes(field.path) || field.path === resumePath || isLinkedInProfile(field);
}

/** Move an editable question by its stable answer key; fixed contacts stay in place. */
export function reorderApplicationQuestions(
  fields: ApplicationField[],
  activePath: string,
  overPath: string,
): ApplicationField[] {
  if (activePath === overPath || fields.some(field => (field.path === activePath || field.path === overPath) && isFixedApplicationField(field))) return fields;
  const positions = fields.flatMap((field, index) => isFixedApplicationField(field) ? [] : [index]);
  const questions = positions.map(index => fields[index]);
  const from = questions.findIndex(field => field.path === activePath);
  const to = questions.findIndex(field => field.path === overPath);
  if (from < 0 || to < 0) return fields;
  const [question] = questions.splice(from, 1);
  questions.splice(to, 0, question);
  const next = [...fields];
  positions.forEach((position, index) => { next[position] = questions[index]; });
  return next;
}
