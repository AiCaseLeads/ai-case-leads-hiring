export const MAX_PDF_BYTES = 10 * 1024 * 1024;
export type PdfResult = {status:"ready"|"no_text"|"password_protected"|"invalid"|"too_many_pages"|"too_large"|"timeout"|"unavailable";text:string;pages:number;truncated:boolean;message:string;ocrPages?:number;ocrIncomplete?:boolean};
export type ResumeText = PdfResult & {fileId:string;filename:string;cached:boolean};
