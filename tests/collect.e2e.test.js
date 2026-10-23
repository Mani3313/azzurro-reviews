/**
 * End-to-end test of the Playwright collector against a local fixture page
 * that mimics Booking.com's review markup. Skipped if Chromium isn't installed
 * (run `npm run setup:browser`).
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { collectProperty } from '../scraper/collect.js';
import { normalizeReview } from '../lib/normalize.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const html = fs.readFileSync(path.join(here, 'fixtures/listing.html'), 'utf8');
let server, port, browser, chromium;

try {
  ({ chromium } = await import('playwright'));
  browser = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});
} catch {
  browser = null;
}

before(async () => {
  server = http.createServer((req, res) => {
    if (req.url.startsWith('/hotel/fixture.en-gb.html')) {
      res.writeHead(200, { 'content-type': 'text/html' });
      res.end(html);
    } else {
      res.writeHead(404);
      res.end();
    }
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  port = server.address().port;
});
after(async () => {
  server?.close();
  await browser?.close();
});

const property = () => ({ slug: 'olympic-paddington', name: 'Fixture', url: `http://127.0.0.1:${port}/hotel/fixture.html` });

test('reads every page newest-first, expands replies, and normalises cleanly', { skip: !browser && 'Chromium not installed' }, async () => {
  const context = await browser.newContext();
  const seen = new Map();
  const res = await collectProperty(context, property(), {
    full: true,
    onPage: async (cards) => {
      let newCount = 0;
      for (const c of cards) {
        const n = normalizeReview(c, { property: 'olympic-paddington', collectedAt: '2026-10-01' });
        assert.equal(n.ok, true, JSON.stringify(n));
        if (!seen.has(n.review._id)) newCount++;
        seen.set(n.review._id, n.review);
      }
      return { newCount, rejected: 0 };
    },
  });
  await context.close();
  assert.equal(res.pagesRead, 3);
  assert.equal(seen.size, 23);
  assert.equal(res.stoppedBecause, 'reached the last page');
  assert.match(res.header, /23 reviews/);
  const dates = [...seen.values()].map((r) => r.reviewDate);
  assert.deepEqual(dates, [...dates].sort().reverse(), 'newest first');
  const withReply = [...seen.values()].filter((r) => r.hotelReply);
  assert.ok(withReply.length > 0 && withReply.every((r) => !r.hotelReplyTruncated), 'replies expanded');
});

test('incremental mode stops after two pages with nothing new', { skip: !browser && 'Chromium not installed' }, async () => {
  const context = await browser.newContext();
  const res = await collectProperty(context, { ...property(), url: property().url }, {
    full: false,
    stopAfterKnownPages: 2,
    onPage: async () => ({ newCount: 0, rejected: 0 }), // everything already known
  });
  await context.close();
  assert.equal(res.pagesRead, 2);
  assert.match(res.stoppedBecause, /caught up/);
});
