// Built Node server, real SQLite/file storage, isolated seeded staff session.
// Google integrations remain disconnected and background processing is disabled.
import assert from 'node:assert/strict';
import { mkdtempSync, realpathSync, rmSync, existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawn, execFileSync } from 'node:child_process';
import { createServer } from 'node:net';
import { randomBytes, createHash } from 'node:crypto';
import { chromium } from 'playwright';
import { SQLiteD1Database } from '../lib/railway/sqlite.ts';
import { withRequiredContacts } from '../lib/hiring/contact-fields.ts';

assert.ok(existsSync('dist/server/index.js'), 'Run npm run build:railway first.');
const dataDir = mkdtempSync(path.join(realpathSync(tmpdir()), 'aicl-lifecycle-http-'));
const reservation = createServer();
await new Promise(resolve => reservation.listen(0, '127.0.0.1', resolve));
const port = reservation.address().port;
await new Promise(resolve => reservation.close(resolve));
const origin = `http://127.0.0.1:${port}`, session = randomBytes(32).toString('hex');
const database = new SQLiteD1Database(path.join(dataDir, 'hiring.sqlite'));
database.migrate(path.resolve('drizzle'));
database.connection.prepare('INSERT INTO staff_sessions(token_hash,user_id,email,full_name,created_at,expires_at) VALUES(?,?,?,?,?,?)')
  .run(createHash('sha256').update(session).digest('hex'), 'synthetic-lifecycle-owner', 'sales@aicaseleads.com', 'Synthetic lifecycle owner', Date.now(), Date.now() + 3600000);
database.close();
let child, browser, logs = '';
function resume() {
  const content = 'BT /F1 12 Tf 72 720 Td (Synthetic lifecycle resume only) Tj ET\n';
  const objects = ['<< /Type /Catalog /Pages 2 0 R >>', '<< /Type /Pages /Kids [3 0 R] /Count 1 >>', '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>', `<< /Length ${Buffer.byteLength(content)} >>\nstream\n${content}endstream`, '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>'];
  let pdf = '%PDF-1.7\n', offsets = [0];
  for (const [index, object] of objects.entries()) { offsets.push(Buffer.byteLength(pdf)); pdf += `${index + 1} 0 obj\n${object}\nendobj\n`; }
  const xref = Buffer.byteLength(pdf);
  pdf += `xref\n0 ${offsets.length}\n0000000000 65535 f \n` + offsets.slice(1).map(offset => String(offset).padStart(10, '0') + ' 00000 n \n').join('') + `trailer\n<< /Size ${offsets.length} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(pdf);
}
async function api(url, method = 'GET', body) {
  const response = await fetch(origin + url, { method, headers: { Cookie: `aicl_staff_session=${session}`, ...(body === undefined ? {} : { Origin: origin, 'Content-Type': 'application/json' }) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  const result = await response.json();
  assert.equal(response.status, 200, JSON.stringify({ url, status: response.status, result }));
  return result.data;
}
async function waitForServer() {
  const began = Date.now();
  while (!logs.includes('[railway] http_ready')) {
    assert.ok(Date.now() - began < 30000 && child.exitCode === null, logs.slice(-1500));
    await new Promise(resolve => setTimeout(resolve, 100));
  }
}
try {
  child = spawn(process.execPath, ['scripts/start-railway.mjs'], { env: { ...process.env, NODE_ENV: 'development', DATA_DIR: dataDir, RAILWAY_DEPLOYMENT_ID: 'synthetic-lifecycle-isolated', RAILWAY_VOLUME_MOUNT_PATH: dataDir, PUBLIC_SITE_ORIGIN: origin, PORT: String(port), ADMIN_EMAILS: 'sales@aicaseleads.com', GOOGLE_CLIENT_ID: 'synthetic.apps.googleusercontent.com', GOOGLE_CLIENT_SECRET: 'synthetic-only', GOOGLE_TOKEN_KEY: '1'.repeat(64), EXPECTED_RECRUITING_EMAIL: 'mariam@aicaseleads.com', BACKGROUND_ENABLED: 'false', APPLICATIONS_ENABLED: 'true' }, stdio: ['ignore', 'pipe', 'pipe'] });
  child.stdout.on('data', value => { logs += value; }); child.stderr.on('data', value => { logs += value; });
  await waitForServer();
  const job = await api('/api/hub/jobs', 'POST', { title: 'Synthetic Lifecycle Engineer', slug: 'synthetic-lifecycle-engineer', department: 'Isolated verification', descriptionHtml: '<p>Synthetic test role. No real recruiting or outreach.</p>', status: 'open', fields: withRequiredContacts([{ path: '_systemfield_resume', title: 'Resume', type: 'File', required: false }]), rules: [], autoReject: false });
  const chrome = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
  browser = await chromium.launch({ headless: true, ...(existsSync(chrome) ? { executablePath: chrome } : {}) });
  const publicContext = await browser.newContext(), application = await publicContext.newPage();
  await application.goto(origin + '/jobs/' + job.slug);
  await application.getByLabel('First name', { exact: false }).fill('Synthetic');
  await application.getByLabel('Last name', { exact: false }).fill('Lifecycle Applicant');
  await application.getByLabel('Email address', { exact: false }).fill('synthetic-lifecycle@example.invalid');
  await application.getByLabel('Phone number', { exact: false }).fill('+1 305 555 0123');
  const original = resume();
  await application.locator('input[type=file]').setInputFiles({ name: 'synthetic-lifecycle-resume.pdf', mimeType: 'application/pdf', buffer: original });
  await application.getByRole('button', { name: 'Submit application', exact: false }).click();
  await application.waitForURL(/\/applications\/[a-f0-9]{64}$/, { timeout: 15000 });
  await publicContext.close();
  const selected = (await api('/api/hub/applications?jobId=' + job.id)).items[0];
  await api('/api/hub/applications/' + selected.id + '/action', 'POST', { action: 'stage', stage: 'Screening', expectedRevision: selected.revision });
  const staff = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  await staff.addCookies([{ name: 'aicl_staff_session', value: session, url: origin, httpOnly: true, sameSite: 'Lax' }]);
  const page = await staff.newPage(), errors = [];
  page.setDefaultTimeout(10000); page.on('pageerror', error => errors.push(error.message));
  await page.goto(origin + '/team?view=applications&jobId=' + job.id);
  await page.getByRole('button', { name: 'Synthetic Lifecycle Applicant', exact: true }).click();
  await page.getByRole('heading', { name: 'Synthetic Lifecycle Applicant', exact: true }).waitFor();
  await page.getByRole('button', { name: 'Delete application', exact: true }).click();
  await page.getByRole('button', { name: 'Move to Trash', exact: true }).click();
  await page.getByRole('button', { name: 'Restore application', exact: true }).waitFor();
  let detail = await api('/api/hub/applications/' + selected.id);
  assert.equal(detail.trashed, true); assert.equal(detail.stage, 'Withdrawn');
  assert.equal((await api('/api/hub/applications?jobId=' + job.id)).total, 0);
  assert.equal((await api('/api/hub/applications?jobId=' + job.id + '&trash=true')).total, 1);
  assert.equal(detail.communications.every(message => message.status === 'cancelled'), true);
  const privateFile = await fetch(origin + detail.files[0].url, { headers: { Cookie: `aicl_staff_session=${session}` } });
  assert.deepEqual(Buffer.from(await privateFile.arrayBuffer()), original);
  assert.equal((await fetch(origin + detail.files[0].url)).status, 403);
  // Download the application PDF while the record is in Trash.
  const pdfPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Download application PDF', exact: true }).click();
  const pdf = await pdfPromise; assert.match(pdf.suggestedFilename(), /\.pdf$/);
  assert.equal(readFileSync(await pdf.path()).subarray(0, 5).toString(), '%PDF-');
  await page.getByRole('button', { name: 'Back to applications', exact: true }).click();
  await page.getByRole('heading', { name: 'No applications in this view', exact: true }).waitFor();
  await page.getByRole('button', { name: 'Trash', exact: true }).click();
  await page.getByRole('button', { name: 'Synthetic Lifecycle Applicant', exact: true }).waitFor();
  const trashUrl = page.url();
  await page.getByRole('button', { name: 'Synthetic Lifecycle Applicant', exact: true }).click();
  await page.getByRole('button', { name: 'Restore application', exact: true }).waitFor();
  await page.goBack(); await page.getByRole('button', { name: 'Synthetic Lifecycle Applicant', exact: true }).waitFor(); assert.equal(page.url(), trashUrl);
  await page.goForward(); await page.getByRole('button', { name: 'Restore application', exact: true }).waitFor();
  await page.getByRole('button', { name: 'Restore application', exact: true }).click();
  await page.getByRole('button', { name: 'Delete application', exact: true }).waitFor();
  detail = await api('/api/hub/applications/' + selected.id);
  assert.equal(detail.trashed, false); assert.equal(detail.stage, 'Screening');
  assert.equal(detail.communications.every(message => message.status === 'cancelled'), true);
  await page.getByRole('button', { name: 'Back to applications', exact: true }).click();
  await page.getByRole('button', { name: 'Applications', exact: true }).click();
  await page.getByRole('button', { name: 'Synthetic Lifecycle Applicant', exact: true }).waitFor();
  await page.locator('.hub-download-menu > summary').click();
  const zipPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Download applications (ZIP)', exact: true }).click();
  const zip = await zipPromise;
  execFileSync('python3', ['-c', 'import sys,zipfile; z=zipfile.ZipFile(sys.argv[1]); assert z.testzip() is None; names=z.namelist(); assert not any(n.endswith((".json",".csv")) for n in names); assert any(n.endswith("Application summary.pdf") for n in names); assert "Download report.pdf" in names; assert len([n for n in names if n.endswith(".pdf")])==3', await zip.path()]);
  assert.deepEqual(errors, []);
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), true);
  console.log(JSON.stringify({ status: 'passed', builtNodeServer: true, realApplicationUpload: true, trashRestore: true, previousStageRetained: 'Screening', browserBackForward: true, privateOriginalBytesRetained: true, cancelledEmailsNotReplayed: true, trashedApplicationPdf: true, zipHasPdfsAndOriginalsOnly: true, limitations: 'Disposable seeded staff account and local storage. Real Google delivery, Railway throughput and hosted Docker image are not exercised.' }));
} catch (error) {
  console.error(logs.slice(-2000)); throw error;
} finally {
  if (browser) await browser.close();
  if (child?.exitCode === null) {
    const done = new Promise(resolve => child.once('exit', resolve));
    child.kill('SIGTERM'); const timer = setTimeout(() => child.kill('SIGKILL'), 55000);
    await done; clearTimeout(timer);
  }
  rmSync(dataDir, { recursive: true, force: true });
}
