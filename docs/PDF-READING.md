# Resume text and local OCR

Opening a candidate's AI evidence panel reads the selected original PDF locally. Text layers use PDF.js. Image-containing pages and vector pages without text use Poppler and Tesseract OCR, including mixed documents with readable headers and scanned experience. OCR supports English and Spanish. No OCR API key or external document service is used. An AI evidence review still requires the reviewer's explicit request and uses the original stored file on the server.

The original PDF is unchanged and remains in private storage and the Drive archive. OCR is a preview, not verified employment or a fraud detector. Review the original for names, dates, columns, handwriting, photographs, other languages, or missing content before assigning a grade.

Limits: 10 MB per PDF, 30 total pages, 8 OCR pages, 30,000 characters, 2200 pixels per image side, one active reader, and a 45-second deadline. Native decoders run one page at a time with one OCR thread; Linux adds 256 MB address space, 15 CPU seconds and 16 MB file limits per native process. Temporary originals and images are removed after success or failure. The full process group is killed on timeout. Applications can still be accepted while readers are busy.

If some text is available but image text cannot be read, the preview explicitly warns that it is incomplete. Transient and incomplete results are not cached. Password protection, unsupported documents, capacity limits and failed reads have a manual fallback. Prior cached scan failures are retried under the version 2 cache.

Railway's Dockerfile installs Poppler, font configuration/basic fonts, Tesseract English/Spanish, and prlimit. No environment changes are necessary on Railway. Local development may set the server-only `PDF_OCR_BIN_DIR` to an absolute directory containing trusted `pdftoppm` and `tesseract` executables; application requests cannot set this path.

Run `PDF_OCR_BIN_DIR=/absolute/trusted/bin npx tsx --test tests/pdf/*.test.ts` for real OCR tests. Image-only and mixed-image fixtures, the OCR page limit and native timeout cleanup require both native binaries; the tests explicitly skip those cases if they are absent. Always run those cases in the deployment image or a configured native environment before declaring OCR verified.
