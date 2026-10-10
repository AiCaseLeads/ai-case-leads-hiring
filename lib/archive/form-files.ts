import type { AshbyApplication, AshbyFile } from "./contracts";
import { sha256 } from "./security";

export async function formFileAnswers(application: AshbyApplication, knownFiles: AshbyFile[]): Promise<AshbyFile[]> {
  const files = new Map<string, AshbyFile>();
  for (const submission of application.applicationFormSubmissions ?? []) {
    const definition = submission.formDefinition as { sections?: Array<{ fields?: Array<{ field: { type: string; path: string; title: string } }> }> };
    const values = submission.submittedValues as Record<string, unknown>;
    if (!definition?.sections || !values || typeof values !== "object") throw new Error("invalid_application_form_export");
    for (const section of definition.sections) for (const entry of section.fields ?? []) {
      const field = entry.field;
      if (field.type !== "File") continue;
      const value = values[field.path];
      if (value == null || value === "") continue;
      if (field.path === "_systemfield_resume" && application.resumeFileHandle) { files.set(application.resumeFileHandle.id, application.resumeFileHandle); continue; }
      for (const item of Array.isArray(value) ? value : [value]) {
        if (typeof item === "object" && item && "id" in item && "name" in item && "handle" in item) {
          const file = item as AshbyFile;
          if (typeof file.id !== "string" || typeof file.name !== "string" || typeof file.handle !== "string") throw new Error("application_file_answer_unresolved");
          files.set(file.id, file);
        } else if (typeof item === "string" && item.length <= 20000) {
          const known = knownFiles.find((file) => file.handle === item);
          // The only remaining contract-safe resolver is file.info. If the provider returns a value that is not a public file handle,
          // that call fails visibly and the application cannot be marked fully archived. Never silently discard a File answer.
          const file = known ?? { id: await sha256(`form-file:${submission.id}:${field.path}:${item}`), name: `${field.title || "Application attachment"}–${submission.id}.bin`, handle: item };
          files.set(file.id, file);
        } else throw new Error("application_file_answer_unresolved");
      }
    }
  }
  return [...files.values()];
}
