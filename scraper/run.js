#!/usr/bin/env node
/**
 * Collect new reviews from Booking.com for all (or some) properties.
 *
 *   npm run scrape                          # incremental: stop once caught up
 *   npm run scrape:full                     # re-read every page (backfill)
 *   npm run scrape -- --property=olympic-paddington
 *   npm run scrape -- --max-pages=5 --headed --save-raw
 *
 * Options
 *   --full              read all pages instead of stopping at known reviews
 *   --property=a,b      only these property slugs
 *   --max-pages=N       page cap per property (default 50 incremental, 500 full)
 *   --headed            show the browser window (useful when diagnosing)
 *   --save-raw          also write the raw cards to data/raw/<slug>-<date>.json
 *   --dry-run           don't write to MongoDB (implies nothing is "known", so use with --max-pages)
 *
 * Exit code: 0 if every property succeeded, 1 if any failed (so a scheduler
 * or CI job can alert on it).
 */
import '../lib/env.js';
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { chromium } from 'playwright';
import { PROPERTIES } from '../config/properties.js';
import { getDb, closeDb } from '../lib/db.js';
import { collectProperty } from './collect.js';
import { ingestCards } from './ingest.js';
import { recordRun, updateProperty } from './store.js';

const args = Object.fromEntries(process.argv.slice(2).map((a) => {
  const [k, v] = a.replace(/^--/, '').split('=');
  return [k, v ?? true];
}));

const selected = args.property
  ? PROPERTIES.filter((p) => String(args.property).split(',').includes(p.slug))
  : PROPERTIES;
if (!selected.length) {
  console.error(`Unknown --property. Valid: ${PROPERTIES.map((p) => p.slug).join(', ')}`);
  process.exit(2);
}

const full = !!args.full;
const dryRun = !!args['dry-run'];
const maxPages = args['max-pages'] ? Number(args['max-pages']) : undefined;
const log = (m) => console.log(m);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const db = dryRun ? null : await getDb();
const browser = await chromium.launch({ headless: !args.headed });
const context = await browser.newContext({
  locale: 'en-GB',
  timezoneId: 'Australia/Sydney',
  viewport: { width: 1366, height: 900 },
});

let failures = 0;
for (const [i, property] of selected.entries()) {
  if (i > 0) await sleep(5000 + Math.random() * 5000); // spread load between properties
  const startedAt = new Date();
  const runId = createHash('sha1').update(`${property.slug}${startedAt.toISOString()}`).digest('hex').slice(0, 12);
  log(`\n▶ ${property.name} (${property.slug}) — ${full ? 'full' : 'incremental'}`);

  const raw = [];
  const problems = new Set();
  let duplicatesInBatch = 0;
  const ctx = { property: property.slug, source: 'scraper', sourceUrl: property.url, collectedAt: startedAt, now: startedAt };

  const onPage = async (cards) => {
    if (args['save-raw']) raw.push(...cards);
    const res = await ingestCards(db, cards, ctx, { dryRun });
    res.problems.forEach((p) => problems.add(p));
    duplicatesInBatch += res.duplicatesInBatch;
    return { newCount: res.newCount, rejected: res.rejected };
  };

  let status = 'success';
  let error = null;
  let result;
  try {
    result = await collectProperty(context, property, { onPage, full, maxPages, log });
    if (result.rejected) status = 'partial';
  } catch (err) {
    status = err.code === 'BLOCKED' ? 'blocked' : 'failed';
    error = { code: err.code || 'ERROR', message: err.message };
    result = err.partialResult || { pagesRead: 0, cardsSeen: 0, newReviews: 0, rejected: 0, warnings: [] };
    failures++;
    log(`  ✖ ${status.toUpperCase()}: ${err.message}`);
  }

  const finishedAt = new Date();
  const run = {
    _id: runId,
    property: property.slug,
    mode: full ? 'full' : 'incremental',
    source: 'scraper',
    status,
    startedAt,
    finishedAt,
    durationMs: finishedAt - startedAt,
    pagesRead: result.pagesRead,
    cardsSeen: result.cardsSeen,
    newReviews: result.newReviews,
    rejected: result.rejected,
    duplicatesInBatch,
    stoppedBecause: result.stoppedBecause || null,
    header: result.header || null,
    warnings: [...(result.warnings || []), ...problems].slice(0, 50),
    error,
  };
  if (!dryRun) {
    await recordRun(db, run);
    await updateProperty(db, property.slug, { header: result.header, collectedAt: finishedAt, success: status !== 'failed' && status !== 'blocked' });
  }
  if (args['save-raw'] && raw.length) {
    const file = path.join('data/raw', `${property.slug}-${finishedAt.toISOString().slice(0, 10)}.json`);
    fs.mkdirSync('data/raw', { recursive: true });
    // Names are hashed by the normaliser; strip them from the raw snapshot too.
    const { reviewerKey } = await import('../lib/normalize.js');
    const cards = raw.map(({ reviewerName, ...c }) => ({ ...c, reviewerKey: reviewerKey(reviewerName) }));
    fs.writeFileSync(file, JSON.stringify({ property: property.slug, source: 'scraper', sourceUrl: property.url, collectedAt: finishedAt, header: result.header, pagesRead: result.pagesRead, reviews: cards }, null, 1));
    log(`  saved ${cards.length} raw cards to ${file}`);
  }
  log(`  ${status === 'success' ? '✔' : status === 'partial' ? '◐' : '✖'} ${result.newReviews} new reviews from ${result.pagesRead} pages${result.stoppedBecause ? ` — ${result.stoppedBecause}` : ''}`);
  if (run.warnings.length) log(`  warnings: ${run.warnings.slice(0, 5).join(' | ')}`);
}

await browser.close();
if (db) await closeDb();
log(`\nDone. ${selected.length - failures}/${selected.length} properties collected.`);
process.exit(failures ? 1 : 0);
