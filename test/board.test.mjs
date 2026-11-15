// Board test: builds dist/ against a fake incident API on 127.0.0.1 and drives it in Chromium.
//   PLAYWRIGHT=<path to playwright/index.mjs> node test/board.test.mjs   (default: the `playwright` package)
import http from 'node:http';
import { readFileSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join, extname } from 'node:path';
import assert from 'node:assert/strict';

const { chromium } = await import(process.env.PLAYWRIGHT || 'playwright');
const launch = process.env.CHROMIUM ? { executablePath: process.env.CHROMIUM, args: ['--no-sandbox'] } : {};

// Fake API: two incidents on the first read, one more per `since` read after the third; ack answers a receipt.
let reads = 0; const acked = [];
const base = [
  { id: 'INC-2', service: 'auth', region: 'eu-west', summary: 'login <b>loop</b>', severity: 'sev1', openedAt: '2026-11-12T03:03:00.000Z' },
  { id: 'INC-1', service: 'exports', region: 'us-east', summary: 'export stuck', severity: 'sev3', openedAt: '2026-11-12T02:00:00.000Z' },
];
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css' };
const server = http.createServer((req, res) => {
  const u = new URL(req.url, 'http://x');
  if (u.pathname === '/api/incidents') {
    reads++;
    const incidents = !u.searchParams.get('since') ? base
      : reads > 3 ? [{ id: `INC-${reads}`, service: 'payments', region: 'ap-south', summary: 'new one', severity: 'sev2', openedAt: new Date().toISOString() }] : [];
    const delay = reads === 1 ? 600 : 0; // first answer slow, so the loader can be seen
    return setTimeout(() => { res.setHeader('content-type', 'application/json'); res.end(JSON.stringify({ updatedAt: new Date().toISOString(), incidents, cursor: `c${reads}` })); }, delay);
  }
  if (u.pathname === '/api/ack') {
    acked.push({ id: u.searchParams.get('id'), cursor: u.searchParams.get('cursor') });
    res.setHeader('content-type', 'application/json');
    return res.end(JSON.stringify({ id: u.searchParams.get('id'), ackedAt: '2026-11-12T03:10:00.000Z', receipt: 'r-test' }));
  }
  const f = join('dist', u.pathname === '/' ? 'index.html' : u.pathname);
  if (!existsSync(f)) { res.statusCode = 404; return res.end(); }
  res.setHeader('content-type', types[extname(f)] || 'application/octet-stream'); res.end(readFileSync(f));
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const origin = `http://127.0.0.1:${server.address().port}`;
execFileSync('node', ['scripts/build.mjs'], { env: { ...process.env, API: `${origin}/api`, SESSION: 'test-session', BUILD_SHA: 'testsha123' }, stdio: 'inherit' });

const browser = await chromium.launch(launch);
let failed = 0;
async function check(name, fn) {
  try { await fn(); console.log(`ok  ${name}`); } catch (e) { failed++; console.log(`FAIL ${name}\n  ${e.message.split('\n')[0]}`); }
}
const t = (id) => `[data-testid="${id}"]`;

try {
  const page = await (await browser.newContext({ locale: 'en-GB', timezoneId: 'Europe/Berlin' })).newPage();
  await page.goto(origin);
  await check('R3 loader shows on open', async () => assert.equal(await page.locator(t('loader')).isVisible(), true));
  await page.locator(t('incident-row')).first().waitFor();
  await check('R3 loader gone once incidents load', async () => assert.equal(await page.locator(t('loader')).count(), 0));
  await check('hooks board, incident-list, empty (hidden) present', async () => {
    for (const h of ['board', 'incident-list', 'empty']) assert.equal(await page.locator(t(h)).count(), 1, h);
    assert.equal(await page.locator(t('empty')).isVisible(), false);
  });
  await check('rows carry data-id, newest first, text escaped', async () => {
    assert.deepEqual(await page.locator(t('incident-row')).evaluateAll((rs) => rs.map((r) => r.dataset.id)), ['INC-2', 'INC-1']);
    assert.match(await page.locator(`${t('incident-row')}[data-id="INC-2"] .what`).textContent(), /login <b>loop<\/b>/);
  });
  await check('R6 build sha in meta and footer', async () => {
    assert.equal(await page.locator('meta[name="build"]').getAttribute('content'), 'testsha123');
    assert.equal(await page.locator(t('build-sha')).textContent(), 'testsha123');
  });
  await check('R5 Berlin en-GB: local time, day first, UTC kept in datetime', async () => {
    const time = page.locator(`${t('incident-row')}[data-id="INC-2"] time`);
    assert.equal(await time.getAttribute('datetime'), '2026-11-12T03:03:00.000Z');
    assert.match(await time.textContent(), /^12\/11\/2026,? 04:03:00$/);
  });
  await check('R1 + R4 a new incident appears on top without a reload', async () => {
    await page.waitForFunction(() => document.querySelectorAll('[data-testid="incident-row"]').length > 2, null, { timeout: 12000 });
    const ids = await page.locator(t('incident-row')).evaluateAll((rs) => rs.map((r) => r.dataset.id));
    assert.match(ids[0], /^INC-\d+$/); assert.notEqual(ids[0], 'INC-2');
  });
  await check('R2 Ack acks that incident with the latest cursor and marks the row', async () => {
    const r = page.locator(`${t('incident-row')}[data-id="INC-1"]`);
    await r.locator(t('ack')).click();
    await r.locator(t('acked')).waitFor();
    assert.equal(acked.at(-1).id, 'INC-1'); assert.match(acked.at(-1).cursor, /^c\d+$/);
    assert.equal(await r.locator(t('ack')).count(), 0);
  });
  await check('R5 Auckland en-NZ: its own zone, day first', async () => {
    const p2 = await (await browser.newContext({ locale: 'en-NZ', timezoneId: 'Pacific/Auckland' })).newPage();
    await p2.goto(origin);
    const time = p2.locator(`${t('incident-row')}[data-id="INC-2"] time`);
    await time.waitFor();
    assert.match(await time.textContent(), /^12\/11\/2026,? 04:03:00\spm$/i);
  });
  await check('R5 New York en-US: month first', async () => {
    const p3 = await (await browser.newContext({ locale: 'en-US', timezoneId: 'America/New_York' })).newPage();
    await p3.goto(origin);
    const time = p3.locator(`${t('incident-row')}[data-id="INC-2"] time`);
    await time.waitFor();
    assert.match(await time.textContent(), /^11\/11\/2026,? 10:03:00\sPM$/);
  });
} finally {
  await browser.close(); server.close();
}
console.log(failed ? `${failed} failed` : 'all passed');
process.exit(failed ? 1 : 0);
