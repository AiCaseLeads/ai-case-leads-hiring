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
