import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";

export async function readablePdf(bytes: Uint8Array) {
  const loading = getDocument({ data: bytes.slice(), disableFontFace: true, useSystemFonts: false, useWorkerFetch: false, useWasm: false, enableXfa: false, verbosity: 0 });
  const pdf = await loading.promise, pages: string[] = [];
  const positions: { x: number; y: number; width: number; page: number; text: string }[] = [];
  try {
    for (let index = 1; index <= pdf.numPages; index++) {
      const page = await pdf.getPage(index), content = await page.getTextContent();
      const strings: string[] = [];
      for (const item of content.items) if ("str" in item) {
        strings.push(item.str);
        positions.push({ x: item.transform[4], y: item.transform[5], width: item.width, page: index, text: item.str });
      }
      pages.push(strings.join("\n"));
    }
    return { text: pages.join("\n"), pages, positions };
  } finally { await loading.destroy(); }
}
