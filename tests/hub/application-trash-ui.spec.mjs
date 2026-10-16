import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createServer } from 'node:http';
import { existsSync, readFileSync } from 'node:fs';
import { build } from 'esbuild';
import { chromium } from 'playwright';
import postcss from 'postcss';
import tailwind from '@tailwindcss/postcss';

const jobs = [
  { id: 'job-trash', title: 'Synthetic Trash Engineer', slug: 'trash-engineer', location: 'Remote', status: 'open', fields: [], rules: [], formVersion: 1 },
  { id: 'job-other', title: 'Synthetic Other Engineer', slug: 'other-engineer', location: 'Remote', status: 'open', fields: [], rules: [], formVersion: 1 },
];
const applicant = {
  id: 'app-trash', revision: 4, name: 'Synthetic Trash Applicant', email: 'synthetic@example.invalid',
  jobId: jobs[0].id, jobTitle: jobs[0].title, stage: 'Screening', qualification: 'review', trashed: false,
  assignee: null, createdAt: 1, updatedAt: 1, source: 'test', fields: [], answers: [],
  files: [{ id: 'retained-pdf', filename: 'synthetic-resume.pdf', url: '/api/files/retained-pdf', contentType: 'application/pdf', size: 100 }],
  history: [], notes: [], scorecards: [], qualificationEvidence: [],
  communications: [{ id: 'queued-email', subject: 'Synthetic receipt', body: 'Fixture only', status: 'pending', createdAt: 1 }],
};
let assets;
async function getAssets() {
  assets ||= (async () => {
    const bundle = await build({ stdin: { contents: `import React from 'react';import{createRoot}from'react-dom/client';import{HiringDashboard}from'./components/hub/dashboard';createRoot(document.getElementById('root')).render(<HiringDashboard member={{email:'owner@example.invalid',role:'admin'}} signOutHref='/logout'/>);`, loader: 'tsx', resolveDir: process.cwd() }, bundle: true, write: false, format: 'iife', jsx: 'automatic' });
    const css = (await postcss([tailwind()]).process(readFileSync('app/globals.css', 'utf8'), { from: 'app/globals.css' })).css + '\n' + readFileSync('components/hub/hub.css', 'utf8');
    return { js: bundle.outputFiles[0].text, css };
  })();
  return assets;
}
async function setup(t, { width = 1280, failDelete = false, failPdf = false, trash = false } = {}) {
  const { js, css } = await getAssets();
  const server = createServer((request, response) => {
    response.setHeader('Content-Type', request.url === '/bundle.js' ? 'text/javascript' : 'text/html');
    response.end(request.url === '/bundle.js' ? js : `<meta name="viewport" content="width=device-width,initial-scale=1"><style>${css}</style><div id="root"></div><script src="/bundle.js"></script>`);
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const chrome = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
  const browser = await chromium.launch({ headless: true, ...(existsSync(chrome) ? { executablePath: chrome } : {}) });
  t.after(async () => { await browser.close(); server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); });
  const page = await browser.newPage({ viewport: { width, height: 900 } });
  page.setDefaultTimeout(6000);
  const errors = [], writes = [], queries = [], pdfQueries = [];
  let current = structuredClone(applicant), pdfAttempt = 0;
  if (trash) current = { ...current, trashed: true, stage: 'Withdrawn' };
  page.on('pageerror', error => errors.push(error.message));
  await page.route('**/api/**', async route => {
    const request = route.request(), url = new URL(request.url());
    if (url.pathname === '/api/hub/applications-export') {
      pdfQueries.push(url.searchParams);
      if (failPdf && ++pdfAttempt === 1) return route.fulfill({ status: 503, json: { error: { message: 'The PDF service is temporarily unavailable. Please try again.' } } });
      return route.fulfill({ contentType: 'application/pdf', body: '%PDF-1.4\nSynthetic browser download fixture\n%%EOF' });
    }
    if (request.method() !== 'GET') {
      const input = request.postDataJSON();
      writes.push({ path: url.pathname, input });
      if (failDelete) return route.fulfill({ status: 409, json: { error: { message: 'Cancel this applicant’s booked or pending interview before moving the application to Trash.' } } });
      await new Promise(resolve => setTimeout(resolve, 100));
      current = { ...current, revision: current.revision + 1, trashed: input.action === 'trash', stage: input.action === 'trash' ? 'Withdrawn' : applicant.stage,
        communications: current.communications.map(item => ({ ...item, status: 'cancelled' })),
        history: [...current.history, { id: 'history-' + current.revision, type: input.action, text: input.action === 'trash' ? 'Moved application to Trash.' : 'Restored application from Trash.', actor: 'owner@example.invalid', createdAt: Date.now() }] };
      return route.fulfill({ json: { data: current } });
    }
    let data = {};
    if (url.pathname === '/api/hub/overview') data = { counts: { applications: current.trashed ? 0 : 1, active: current.trashed ? 0 : 1, rejected: 0, hired: 0 }, stageCounts: [], recentApplications: [], integrations: { google: true, drive: true, applicationsEnabled: true }, jobs };
    if (url.pathname === '/api/hub/application-counts') data = { items: [{ jobId: jobs[0].id, total: current.trashed ? 0 : 1, needsReview: 0, aiReady: 0 }] };
    if (url.pathname === '/api/hub/applications') {
      queries.push(url.searchParams);
      const visible = url.searchParams.get('jobId') === current.jobId && (url.searchParams.get('trash') === 'true') === current.trashed;
      data = { items: visible ? [current] : [], total: visible ? 1 : 0, page: 1, pageSize: 30 };
    }
    if (url.pathname === '/api/hub/applications/' + applicant.id) data = current;
    if (url.pathname === '/api/hub/jobs') data = jobs;
    if (url.pathname === '/api/scorecards') data = { template: null, revision: 0, templates: [], archived: [], bindings: {} };
    if (url.pathname === '/api/job-setup') data = { revision: 0, templates: [], requests: [], locations: {} };
    if (url.pathname === '/api/ai/config') data = { configured: false, enabled: false, reviewOnly: true };
    if (url.pathname === '/api/ai/match') data = { enabled: false, available: false, status: 'disabled', criteria: [] };
    if (url.pathname === '/api/review-reminders') data = { total: 0, applications: [], staff: [], config: { enabled: false, dueHours: 48, fallbackAdmins: [] } };
    return route.fulfill({ json: { data } });
  });
  await page.goto(`http://127.0.0.1:${server.address().port}/?view=applications&jobId=${jobs[0].id}${trash ? '&trash=true' : ''}`);
  await page.getByRole('button', { name: applicant.name, exact: true }).waitFor();
  return { page, writes, queries, errors, pdfQueries, current: () => current };
}
async function openApplicant(page) {
  await page.getByRole('button', { name: applicant.name, exact: true }).click();
  await page.getByRole('heading', { name: applicant.name, exact: true }).waitFor();
}

test('Delete opens a reversible confirmation; Keep application leaves the record untouched', async t => {
  const { page, writes, errors } = await setup(t);
  await openApplicant(page);
  await page.getByRole('button', { name: 'Delete application', exact: true }).click();
  await page.getByRole('alertdialog', { name: 'Move this application to Trash?' }).waitFor();
  assert.equal(writes.length, 0);
  await page.getByRole('button', { name: 'Keep application', exact: true }).click();
  assert.equal(await page.getByRole('alertdialog').count(), 0);
  assert.equal(writes.length, 0);
  assert.deepEqual(errors, []);
});

for (const width of [390, 1280]) test(`Trash and Restore retain PDFs and previous stage at ${width}px without replaying email`, async t => {
  const { page, writes, current, errors } = await setup(t, { width });
  await openApplicant(page);
  await page.getByRole('button', { name: 'Delete application', exact: true }).click();
  await page.getByRole('button', { name: 'Move to Trash', exact: true }).evaluate(element => { element.click(); element.click(); });
  await page.getByRole('button', { name: 'Restore application', exact: true }).waitFor();
  assert.equal(writes.length, 1);
  assert.deepEqual(writes[0].input, { action: 'trash', expectedRevision: 4 });
  assert.equal(await page.getByRole('button', { name: 'Request interview', exact: true }).count(), 0);
  await page.getByRole('button', { name: 'Back to applications', exact: true }).click();
  await page.getByRole('heading', { name: 'No applications in this view', exact: true }).waitFor();
  await page.getByRole('button', { name: 'Trash', exact: true }).click();
  await page.getByRole('button', { name: applicant.name, exact: true }).waitFor();
  const trashUrl = page.url();
  await openApplicant(page);
  await page.goBack();
  await page.getByRole('button', { name: applicant.name, exact: true }).waitFor();
  assert.equal(page.url(), trashUrl);
  await page.goForward();
  await page.getByRole('button', { name: 'Restore application', exact: true }).waitFor();
  await page.getByRole('button', { name: 'Restore application', exact: true }).click();
  await page.getByRole('button', { name: 'Delete application', exact: true }).waitFor();
  assert.deepEqual(writes.map(write => write.input), [{ action: 'trash', expectedRevision: 4 }, { action: 'restore', expectedRevision: 5 }]);
  assert.equal(current().stage, 'Screening');
  assert.equal(current().files[0].filename, 'synthetic-resume.pdf');
  assert.equal(current().communications[0].status, 'cancelled');
  await page.getByRole('button', { name: 'Back to applications', exact: true }).click();
  await page.getByRole('heading', { name: 'No applications in this view', exact: true }).waitFor();
  await page.getByRole('button', { name: 'Applications', exact: true }).click();
  await page.getByRole('button', { name: applicant.name, exact: true }).waitFor();
  assert.equal(new URL(page.url()).searchParams.has('trash'), false);
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), true);
  assert.deepEqual(errors, []);
});

test('a booked interview blocks deletion visibly without losing the applicant or closing confirmation', async t => {
  const { page, current } = await setup(t, { failDelete: true });
  await openApplicant(page);
  await page.getByRole('button', { name: 'Delete application', exact: true }).click();
  await page.getByRole('button', { name: 'Move to Trash', exact: true }).click();
  await page.getByRole('alert').filter({ hasText: 'Cancel this applicant' }).waitFor();
  assert.equal(current().trashed, false);
  assert.equal(await page.getByRole('alertdialog').isVisible(), true);
  assert.equal(await page.getByRole('button', { name: 'Restore application', exact: true }).count(), 0);
});

test('Trash context survives Back/Forward but does not leak into Home or another job', async t => {
  const { page, queries } = await setup(t, { trash: true });
  const trashUrl = page.url();
  await page.getByRole('navigation', { name: 'Hiring workspace' }).getByRole('button', { name: 'Home', exact: true }).click();
  await page.getByRole('heading', { name: 'Hiring overview', exact: true }).waitFor();
  assert.equal(new URL(page.url()).searchParams.has('trash'), false);
  await page.goBack();
  await page.getByRole('button', { name: applicant.name, exact: true }).waitFor();
  assert.equal(page.url(), trashUrl);
  await page.goForward();
  await page.getByRole('heading', { name: 'Hiring overview', exact: true }).waitFor();
  await page.getByRole('listitem').filter({ hasText: jobs[1].title }).getByRole('button', { name: 'View applicants', exact: true }).click();
  await page.getByRole('heading', { name: jobs[1].title, exact: true }).waitFor();
  assert.equal(new URL(page.url()).searchParams.has('trash'), false);
  assert.equal(queries.at(-1).has('trash'), false);
});

test('failed PDF download explains the error and can be retried as PDF for a trashed application', async t => {
  const { page, pdfQueries, errors } = await setup(t, { failPdf: true, trash: true });
  await openApplicant(page);
  const download = page.getByRole('button', { name: 'Download application PDF', exact: true });
  await download.click();
  await page.getByRole('alert').filter({ hasText: 'The PDF service is temporarily unavailable' }).waitFor();
  assert.equal(await download.isEnabled(), true);
  const received = page.waitForEvent('download');
  await download.click();
  assert.equal((await received).suggestedFilename(), 'application-app-trash.pdf');
  for (const query of pdfQueries) {
    assert.equal(query.get('format'), 'pdf');
    assert.equal(query.get('jobId'), jobs[0].id);
    assert.equal(query.get('ids'), applicant.id);
    assert.equal(query.get('trash'), 'true');
  }
  assert.deepEqual(errors, []);
});
