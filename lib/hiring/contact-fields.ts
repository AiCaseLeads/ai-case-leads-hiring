import type { ApplicationField, FieldSubmission } from "./types";

export const contactPaths = ["_systemfield_name", "_systemfield_last_name", "_systemfield_email", "_systemfield_phone"];
export function withRequiredContacts(fields: ApplicationField[]): ApplicationField[] {
  const contacts: ApplicationField[] = [
    {path:contactPaths[0],title:"First name",type:"String",required:true},
    {path:contactPaths[1],title:"Last name",type:"String",required:true},
    {path:contactPaths[2],title:"Email address",type:"Email",required:true},
    {path:contactPaths[3],title:"Phone number",type:"Phone",required:true,description:"Include + and your country code, followed by the area code and phone number. For example: +1 305 555 0123."},
  ];
  return [...contacts, ...fields.filter(field => !contactPaths.includes(field.path))];
}
export function internationalPhoneError(value: unknown): string | null {
  if (typeof value !== "string" || !/^\+[1-9][\d ()-]*$/.test(value.trim()) || !/^\+[1-9]\d{6,14}$/.test(value.replace(/[ ()-]/g,"")))
    return "Include + and your country code, area code and number, for example +1 305 555 0123.";
  return null;
}
export function applicantDisplayName(answers: FieldSubmission[]): string {
  return ["_systemfield_name", "_systemfield_last_name"].map(path => String(answers.find(answer => answer.path === path)?.value || "").trim()).filter(Boolean).join(" ");
}

/** Public applications always collect a canonical international phone, including legacy jobs. */
export function withRequiredPhone(fields: ApplicationField[]): ApplicationField[] {
  const phone=withRequiredContacts([]).find(field=>field.path==="_systemfield_phone")!;
  if(fields.some(field=>field.path===phone.path))return fields.map(field=>field.path===phone.path?phone:field);
  // Preserve legacy/custom fields and their answers; add the fixed contact without deleting them.
  const position=fields.findIndex(field=>field.path==="_systemfield_email");
  const result=[...fields];result.splice(position<0?0:position+1,0,phone);return result;
}

/**
 * LinkedIn and résumé stay required unless a job owner explicitly marked them optional with
 * `ownerOptional: true`. Legacy or hand-edited fields with only `required: false` stay required.
 */
function ownerChoice(field: ApplicationField | undefined): Pick<ApplicationField, "required" | "ownerOptional"> {
  return field?.ownerOptional === true ? { required: false, ownerOptional: true } : { required: true };
}

/** Fixed upload field for all new public applications, including legacy postings. */
export const resumePath = "_systemfield_resume";
export function withRequiredResume(fields: ApplicationField[]): ApplicationField[] {
  const resume = (field?: ApplicationField): ApplicationField => ({ path: resumePath, title: "Résumé / CV", type: "File", ...ownerChoice(field) });
  if (fields.some(field => field.path === resumePath)) return fields.map(field => field.path === resumePath ? resume(field) : field);
  return [...fields, resume()];
}
export function withRequiredApplicationFields(fields: ApplicationField[]): ApplicationField[] {
  return withRequiredLinkedIn(withRequiredResume(withRequiredPhone(fields)));
}

/** Keep existing LinkedIn URL paths stable so historical answers and rules stay linked. */
export const linkedInPath = "linkedin_profile";
export function isLinkedInProfile(field: ApplicationField): boolean {
  return field.path === linkedInPath || ((field.type === "Url" || field.type === "SocialLink") && /linkedin/i.test(`${field.path} ${field.title}`));
}
export function withRequiredLinkedIn(fields: ApplicationField[]): ApplicationField[] {
  const canonical = (path: string, field?: ApplicationField): ApplicationField => ({path, title:"LinkedIn profile",type:"SocialLink",...ownerChoice(field),description:"Enter your LinkedIn profile URL, for example https://www.linkedin.com/in/your-name."});
  if (fields.some(isLinkedInProfile)) return fields.map(field => {
    if (!isLinkedInProfile(field)) return field;
    return { ...withoutOwnerChoice(field), ...canonical(field.path, field) };
  });
  return [...fields, canonical(linkedInPath)];
}

/** Job-owner switch for the built-in LinkedIn and résumé fields. Other fields are unchanged. */
export type OptionalSystemField = "linkedin" | "resume";
export function isOptionalSystemField(field: ApplicationField, which: OptionalSystemField): boolean {
  return which === "resume" ? field.path === resumePath : isLinkedInProfile(field);
}
export function setSystemFieldRequired(fields: ApplicationField[], which: OptionalSystemField, required: boolean): ApplicationField[] {
  return fields.map(field => {
    if (!isOptionalSystemField(field, which)) return field;
    const rest = withoutOwnerChoice(field);
    return required ? { ...rest, required: true } : { ...rest, required: false, ownerOptional: true };
  });
}
function withoutOwnerChoice(field: ApplicationField): ApplicationField {
  const copy = { ...field };
  delete copy.ownerOptional;
  return copy;
}
