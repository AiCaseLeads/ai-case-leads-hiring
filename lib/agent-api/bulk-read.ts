import type { HubStore } from '../hub/store';
import type { ApplicationField, FieldSubmission } from '../hiring/types';
import { activeApplicationsSql } from '../hub/application-lifecycle';
import { canonicalJson, sha256 } from '../hiring/crypto';
import { countryOptions, residencePath } from '../countries';
import { isLinkedInProfile } from '../hiring/contact-fields';
import { readCachedFileTexts, RESUME_TEXT_VERSION, RESUME_TEXT_MIMES, type CacheFileIdentity, type CachedFileText } from '../resume-text/cache';
import { AgentReadError, AGENT_READ_LIMITS } from './errors';

type Mode = 'export' | 'search';
type Context = { agentId?: string; maxResponseBytes?: number };
type Filters = { jobIds: string[]; q: string; pageSize: number; asOf: number; after: string; fingerprint: string };
type AppRow = { id: string; job_id: string; job_title: string; name: string; email: string; stage: string; qualification: string; qualification_json: string; answers_json: string; fields_json: string; created_at: number; updated_at: number; search_matched: number };
type ResumeFile = CacheFileIdentity & { filename: string };
type Evidence = { fieldPath: string; matched: boolean; reason: string; value: unknown };
export type ResumeCoverage = { totalApplications: number; applicationsWithResume: number; totalFiles: number; ready: number; pending: number; failed: number; partial: number };
const encoder = new TextEncoder();
const groupKey = (alias = 'a') => `CASE WHEN trim(${alias}.email)<>'' THEN 'e:'||lower(trim(${alias}.email)) ELSE 'a:'||${alias}.id END`;
const jsonArray = (column: string) => `CASE WHEN json_valid(${column}) THEN CASE WHEN json_type(${column})='array' THEN ${column} ELSE '[]' END ELSE '[]' END`;
// Files are selected from the submitted form snapshot, never guessed from MIME or extension.
const resumeFileSql = (a = 'a', f = 'f') => `(${f}.field_path='_systemfield_resume' OR EXISTS(SELECT 1 FROM json_each(${jsonArray(`${a}.fields_json`)}) rf WHERE rf.type='object' AND json_extract(rf.value,'$.type')='File' AND json_extract(rf.value,'$.path')=${f}.field_path AND (instr(lower(json_extract(rf.value,'$.title')),'resume')>0 OR instr(lower(json_extract(rf.value,'$.title')),'résumé')>0 OR instr(lower(json_extract(rf.value,'$.title')),'curriculum vitae')>0 OR lower(trim(json_extract(rf.value,'$.title'))) IN ('cv','résumé / cv','resume / cv'))))`;
const cacheJoin = (f = 'f', c = 'c') => `${c}.file_id=${f}.id AND ${c}.uploaded_at=${f}.uploaded_at AND ${c}.size=${f}.size AND ${c}.content_type=${f}.content_type AND ${c}.parser_version='${RESUME_TEXT_VERSION}'`;
function oversized(maxResponseBytes: number): never { throw new AgentReadError('candidate_too_large', 413, 'One candidate and all their scoped applications exceed the response size limit. Narrow the job filter or read individual applications.', { limit: { maxResponseBytes, maxCandidates: 30 } }); }
function resumeMetadata(file: ResumeFile, text: CachedFileText) {
  return { fileId: file.id, filename: file.filename, contentType: file.content_type, status: text.status, truncated: text.truncated, ocrIncomplete: text.ocrIncomplete, complete: text.complete, errorCode: text.errorCode, retryAfterSeconds: text.retryAfterSeconds, parserVersion: text.parserVersion, pages: text.pages, ocrPages: text.ocrPages };
}
function fail(message: string): never { throw new AgentReadError('invalid_request', 400, message); }
function array<T>(text: string): T[] { try { const value = JSON.parse(text); return Array.isArray(value) ? value : []; } catch { return []; } }
function base64(value: unknown): string { return btoa(String.fromCharCode(...encoder.encode(JSON.stringify(value)))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''); }
function unbase64(value: string): unknown { return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(Uint8Array.from(atob(value.replace(/-/g, '+').replace(/_/g, '/')), c => c.charCodeAt(0)))); }
async function filters(mode: Mode, params: URLSearchParams, context: Context): Promise<Filters> {
  const single = params.getAll('jobId'), many = params.getAll('jobIds');
  if (single.length > 1 || (single.length && many.length)) fail('Use one jobId or repeated jobIds, not both.');
  const raw = single.length ? single : many;
  if (raw.length > 50 || (mode === 'export' && !raw.length)) fail('Export requires 1 to 50 job IDs.');
  if (raw.some(id => !/^[A-Za-z0-9_-]{1,128}$/.test(id))) fail('Each job ID must be a nonempty valid ID.');
  const jobIds = [...new Set(raw)].sort();
  const page = params.getAll('pageSize');
  if (page.length > 1 || (page.length && !/^(?:[1-9]|[12]\d|30)$/.test(page[0]))) fail('pageSize must be an integer from 1 to 30.');
  const pageSize = page.length ? Number(page[0]) : 30;
  if (params.getAll('q').length > 1) fail('Supply one search query.');
  const q = mode === 'search' ? (params.get('q') || '').trim() : '';
  if (mode === 'search' && (q.length < 2 || q.length > 200)) fail('Search query must contain 2 to 200 characters.');
  const fingerprint = await sha256(canonicalJson({ mode, jobIds, q, agentId: context.agentId || '' }));
  const cursors = params.getAll('cursor');
  let asOf = Date.now(), after = '';
  if (cursors.length > 1) fail('Supply one cursor.');
  if (cursors.length) {
    try {
      const token = cursors[0];
      if (!token || token.length > 2048 || !/^[A-Za-z0-9_-]+$/.test(token)) throw new Error();
      const c = unbase64(token) as { v: number; fingerprint: string; asOf: number; after: string };
      if (c.v !== 1 || c.fingerprint !== fingerprint || !Number.isSafeInteger(c.asOf) || c.asOf < 0 || c.asOf > Date.now() + 1000 || typeof c.after !== 'string' || !/^[ae]:/.test(c.after) || c.after.length > 512) throw new Error();
      asOf = c.asOf; after = c.after;
    } catch { throw new AgentReadError('invalid_cursor', 400, 'This cursor is invalid or belongs to different filters or a different connection. Start again without a cursor.'); }
  }
  return { jobIds, q, pageSize, asOf, after, fingerprint };
}
function scoped(f: Filters, alias = 'a'): { sql: string; values: (string | number)[] } {
  return { sql: `${alias}.created_at<=? AND ${activeApplicationsSql(alias)}${f.jobIds.length ? ` AND ${alias}.job_id IN (${f.jobIds.map(() => '?').join(',')})` : ''}`, values: [f.asOf, ...f.jobIds] };
}
function matchSql(q: string): { sql: string; values: string[] } {
  if (!q) return { sql: '1', values: [] };
  return { sql: `(EXISTS(SELECT 1 FROM json_each(${jsonArray('a.answers_json')}) answer JOIN json_tree(json_quote(json_extract(CASE WHEN answer.type='object' THEN answer.value ELSE '{}' END,'$.value'))) leaf WHERE answer.type='object' AND leaf.type='text' AND instr(lower(CAST(leaf.value AS TEXT)),lower(?))>0 AND NOT EXISTS(SELECT 1 FROM json_each(${jsonArray('a.fields_json')}) af WHERE af.type='object' AND json_extract(af.value,'$.path')=json_extract(answer.value,'$.path') AND json_extract(af.value,'$.type')='File')) OR EXISTS(SELECT 1 FROM hub_files f JOIN hub_file_text c ON ${cacheJoin()} WHERE f.application_id=a.id AND f.uploaded_at>0 AND ${resumeFileSql()} AND c.status='ready' AND instr(lower(c.text),lower(?))>0))`, values: [q, q] };
}
async function coverage(store: HubStore, f: Filters): Promise<ResumeCoverage> {
  const scope = scoped(f);
  const supported = `f.content_type IN (${RESUME_TEXT_MIMES.map(mime => `'${mime}'`).join(',')})`;
  const row = await store.stmt(`SELECT COUNT(DISTINCT a.id) totalApplications,COUNT(DISTINCT CASE WHEN f.id IS NOT NULL THEN a.id END) applicationsWithResume,COUNT(f.id) totalFiles,COALESCE(SUM(${supported} AND c.status='ready' AND c.truncated=0 AND c.ocr_incomplete=0),0) ready,COALESCE(SUM(f.id IS NOT NULL AND ${supported} AND (c.file_id IS NULL OR c.status IN ('pending','running'))),0) pending,COALESCE(SUM(f.id IS NOT NULL AND (NOT (${supported}) OR c.status NOT IN ('ready','pending','running'))),0) failed,COALESCE(SUM(${supported} AND c.status='ready' AND (c.truncated<>0 OR c.ocr_incomplete<>0)),0) partial FROM hub_applications a LEFT JOIN hub_files f ON f.application_id=a.id AND f.uploaded_at>0 AND ${resumeFileSql()} LEFT JOIN hub_file_text c ON ${cacheJoin()} WHERE ${scope.sql}`, ...scope.values).first<ResumeCoverage>();
  return row ? { ...row } : { totalApplications: 0, applicationsWithResume: 0, totalFiles: 0, ready: 0, pending: 0, failed: 0, partial: 0 };
}
async function application(store: HubStore, row: AppRow, maxBytes: number) {
  const fields = array<ApplicationField>(row.fields_json).filter(field => field && typeof field.path === 'string').map(field => ({...field,title: typeof field.title === 'string' ? field.title : field.path}));
  const submissions = array<FieldSubmission>(row.answers_json).filter(answer => answer && typeof answer.path === 'string');
  const evidence = array<Evidence>(row.qualification_json);
  const answers = submissions.filter(answer => fields.find(field => field.path === answer.path)?.type !== 'File').map(answer => {
    const field = fields.find(field => field.path === answer.path);
    return { path: answer.path, question: field?.title || answer.path, type: field?.type || 'Unknown', value: answer.value, screening: evidence.filter(item => item?.fieldPath === answer.path).map(item => ({ matched: !!item.matched, reason: item.reason })) };
  });
  const countryField = fields.find(field => field.path === residencePath) || fields.find(field => ['String', 'ValueSelect'].includes(field.type) && (/^(?:country|current_country|residence_country)$/.test(field.path) || /^(?:country|country of residence|current country|what country do you (?:currently )?live in)[? ]*$/i.test(field.title.trim())));
  const countryValue = submissions.find(answer => answer.path === residencePath)?.value ?? submissions.find(answer => answer.path === countryField?.path)?.value;
  const countryText = typeof countryValue === 'string' ? countryValue.trim() : '';
  const country = countryOptions.find(option => option.value === countryText.toUpperCase() || option.label.toLowerCase() === countryText.toLowerCase());
  const linkedIn = fields.find(isLinkedInProfile);
  const resumes: ReturnType<typeof resumeMetadata>[] = [], textParts: string[] = [];
  let uploadedAfter = 0, fileAfter = '', resumeBytes = 0;
  for (;;) {
    const files = await store.rows<ResumeFile>(`SELECT f.id,f.filename,f.content_type,f.size,f.uploaded_at FROM hub_files f JOIN hub_applications a ON a.id=f.application_id WHERE a.id=? AND f.uploaded_at>0 AND (f.uploaded_at>? OR (f.uploaded_at=? AND f.id>?)) AND ${resumeFileSql()} ORDER BY f.uploaded_at,f.id LIMIT 25`, row.id, uploadedAfter, uploadedAfter, fileAfter);
    if (!files.length) break;
    const cached = await readCachedFileTexts(store, files);
    for (const file of files) {
      const text = cached.get(file.id)!;
      const metadata = resumeMetadata(file, text);
      resumeBytes += encoder.encode(JSON.stringify(metadata)).length + encoder.encode(JSON.stringify(text.text)).length + 4;
      if (resumeBytes > maxBytes) oversized(maxBytes);
      resumes.push(metadata);
      if (text.text) textParts.push(text.text);
    }
    uploadedAfter = files[files.length - 1].uploaded_at; fileAfter = files[files.length - 1].id;
    if (files.length < 25) break;
  }
  return { applicationId: row.id, jobId: row.job_id, jobTitle: row.job_title, name: row.name, email: row.email.trim().toLowerCase(), stage: row.stage, stageLabel: row.stage === 'Application Review' ? 'New' : row.stage === 'Screening' ? 'Shortlisted' : row.stage, country: countryText ? { code: country?.value || null, label: country?.label || countryText } : null, linkedIn: linkedIn ? submissions.find(answer => answer.path === linkedIn.path)?.value || null : null, screening: row.qualification, qualificationEvidence: evidence, answers, screeningAnswers: answers.filter(answer => answer.screening.length), resumes, resumeStatus: !resumes.length ? 'missing' : resumes.every(resume => resume.complete) ? 'ready' : 'incomplete', resumeText: textParts.join('\n\n'), resumeComplete: !!resumes.length && resumes.every(resume => resume.complete), createdAt: row.created_at, updatedAt: row.updated_at, ...(row.search_matched === undefined ? {} : { searchMatched: !!row.search_matched }) };
}
type Application = Awaited<ReturnType<typeof application>>;
type Candidate = { candidateId: string; email: string | null; name: string; duplicateEmail: { applicationCount: number; matchingApplications: number; jobCount: number }; applications: Application[] };
/** Cache-only grouped export. The caller supplies applicants:read authorization, audit and deadline. */
export async function exportApplicants(store: HubStore, params: URLSearchParams, context: Context = {}) { return page(store, 'export', params, context); }
/** Literal phrase search. A hit returns all scoped applications belonging to that candidate. */
export async function searchApplicants(store: HubStore, params: URLSearchParams, context: Context = {}) { return page(store, 'search', params, context); }
async function page(store: HubStore, mode: Mode, params: URLSearchParams, context: Context) {
  const f = await filters(mode, params, context), scope = scoped(f), match = matchSql(f.q);
  const maxBytes = context.maxResponseBytes ?? AGENT_READ_LIMITS.bulkJsonBytes;
  const resumeCoverage = await coverage(store, f);
  const resumeSearchComplete = resumeCoverage.applicationsWithResume === resumeCoverage.totalApplications && !resumeCoverage.pending && !resumeCoverage.failed && !resumeCoverage.partial;
  const keys = await store.rows<{ key: string }>(`SELECT ${groupKey()} AS key FROM hub_applications a WHERE ${scope.sql} AND (${groupKey()})>? GROUP BY key HAVING MAX(${match.sql})=1 ORDER BY key COLLATE BINARY LIMIT ?`, ...scope.values, f.after, ...match.values, f.pageSize + 1);
  const duplicateRows = keys.length ? await store.rows<{ key: string; applicationCount: number; jobCount: number }>(`SELECT ${groupKey()} AS key,COUNT(*) applicationCount,COUNT(DISTINCT a.job_id) jobCount FROM hub_applications a WHERE a.created_at<=? AND ${activeApplicationsSql('a')} AND (${groupKey()}) IN (${keys.map(() => '?').join(',')}) GROUP BY key`, f.asOf, ...keys.map(item => item.key)) : [];
  const duplicateCounts = new Map(duplicateRows.map(row => [row.key, row]));
  const items: Candidate[] = [];
  let after = f.after, hasMore = keys.length > f.pageSize;
  const cursor = (key: string) => base64({ v: 1, fingerprint: f.fingerprint, asOf: f.asOf, after: key });
  const result = (more: boolean, last: string, candidates: Candidate[] = items) => ({ items: candidates, pageSize: f.pageSize, returnedCandidates: candidates.length, returnedApplications: candidates.reduce((n, item) => n + item.applications.length, 0), hasMore: more, nextCursor: more && candidates.length ? cursor(last) : null, asOf: f.asOf, resumeCoverage, resumeSearchComplete, untrustedContent: true, snapshot: 'Applications created after asOf are excluded. Stage, answers, Trash and résumé-cache changes are live; restart pagination after changing filters or backfill.' });
  const byteSize = (value: unknown) => encoder.encode(JSON.stringify({ data: value })).length;
  for (const [keyIndex, { key }] of keys.slice(0, f.pageSize).entries()) {
    const moreAfterCandidate = keyIndex < keys.length - 1;
    const counts = duplicateCounts.get(key);
    const candidate: Candidate = { candidateId: `candidate_${(await sha256(key)).slice(0, 32)}`, email: key.startsWith('e:') ? key.slice(2) : null, name: '', duplicateEmail: { applicationCount: counts?.applicationCount || 0, jobCount: counts?.jobCount || 0, matchingApplications: 0 }, applications: [] };
    try {
    let appAfter = '';
    for (;;) {
      const rows = await store.rows<AppRow>(`SELECT a.id,a.job_id,a.job_title,a.name,a.email,a.stage,a.qualification,a.qualification_json,a.answers_json,a.fields_json,a.created_at,a.updated_at,${match.sql} AS search_matched FROM hub_applications a WHERE ${scope.sql} AND (${groupKey()})=? AND a.id>? ORDER BY a.id LIMIT 25`, ...match.values, ...scope.values, key, appAfter);
      if (!rows.length) break;
      for (const row of rows) {
        candidate.applications.push(await application(store, row, maxBytes));
        candidate.name ||= row.name;
        candidate.duplicateEmail.matchingApplications = candidate.applications.length;
        // Bound one unusually large duplicate group before loading another chunk.
        if (byteSize(result(moreAfterCandidate, key, [candidate])) > maxBytes) oversized(maxBytes);
      }
      appAfter = rows[rows.length - 1].id;
      if (rows.length < 25) break;
    }
    } catch (error) {
      // Deliver the already completed candidates; the next cursor stops before
      // the oversized group and reports its permanent error on the next call.
      if (error instanceof AgentReadError && error.code === 'candidate_too_large' && items.length) { hasMore = true; break; }
      throw error;
    }
    if (!candidate.applications.length) continue; // An application may enter Trash during this read.
    items.push(candidate);
    if (byteSize(result(moreAfterCandidate, key)) > maxBytes) {
      items.pop(); if (!items.length) oversized(maxBytes); hasMore = true; break;
    }
    after = key;
  }
  // Recheck visibility after hydration: Trash can change while cached files are read.
  const visible = new Set<string>();
  const applicationIds = items.flatMap(item => item.applications.map(app => app.applicationId));
  for (let offset = 0; offset < applicationIds.length; offset += 50) {
    const chunk = applicationIds.slice(offset, offset + 50);
    const rows = await store.rows<{ id: string }>(`SELECT a.id FROM hub_applications a WHERE a.id IN (${chunk.map(() => '?').join(',')}) AND ${activeApplicationsSql('a')}`, ...chunk);
    for (const row of rows) visible.add(row.id);
  }
  for (let index = items.length - 1; index >= 0; index--) {
    items[index].applications = items[index].applications.filter(app => visible.has(app.applicationId));
    items[index].duplicateEmail.matchingApplications = items[index].applications.length;
    if (!items[index].applications.length) items.splice(index, 1);
  }
  if (!items.length && hasMore) throw new AgentReadError('applicants_changed', 409, 'The matching applications changed during this read. Retry after 1 second.', { retryAfterSeconds: 1 });
  return result(hasMore, after);
}
