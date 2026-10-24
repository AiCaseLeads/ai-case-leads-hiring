import { renderPdfIsolated } from "./render-isolated";
import type { ReadableApplication, MissingExportFile } from "./application-renderer";
export type { ReadableApplication, MissingExportFile } from "./application-renderer";
export function applicationPdf(application: ReadableApplication): Promise<Uint8Array> {
  return renderPdfIsolated({kind:"application",input:application});
}
export function exportReportPdf(input: {jobId:string;applicationCount:number;includedFiles:number;missingFiles:MissingExportFile[];exportedAt:number}):Promise<Uint8Array> {
  return renderPdfIsolated({kind:"report",input});
}
