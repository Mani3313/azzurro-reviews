#!/usr/bin/env node
/**
 * Import raw review snapshots (JSON) into MongoDB through the same
 * validation, fingerprinting and classification as the live scraper.
 *
 *   npm run seed                       # loads the bundled sample data (data/raw/*.json)
 *   npm run import -- path/to/file.json [more files...]
 *
 * File format (what `npm run scrape -- --save-raw` and the browser-assisted
 * collector in scraper/browser-collector.js both write):
 *   { property, collectedAt, sourceUrl, header, reviews: [ raw card, ... ] }
 *
 * Importing the same file twice is safe: known reviews are recognised by
 * their fingerprint and not duplicated.
 */
import '../lib/env.js';
import fs from 'node:fs';
import path from 'node:path';
import { PROPERTY_BY_SLUG } from '../config/properties.js';
import { getDb, closeDb } from '../lib/db.js';
import { ingestCards } from './ingest.js';
import { recordRun, updateProperty } from './store.js';

const files = process.argv.slice(2).filter((a) => !a.startsWith('--'));
if (!files.length) {
  console.error('Usage: npm run import -- <file.json> [...]');
  process.exit(2);
}

const db = await getDb();
let failed = 0;
for (const file of files) {
  const started = new Date();
  try {
    const batch = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (!PROPERTY_BY_SLUG[batch.property]) throw new Error(`unknown property "${batch.property}"`);
    if (!Array.isArray(batch.reviews)) throw new Error('file has no "reviews" array');
    const collectedAt = batch.collectedAt ? new Date(batch.collectedAt) : started;
    const ctx = { property: batch.property, source: batch.source || 'import', sourceUrl: batch.sourceUrl, collectedAt, now: collectedAt };
    const res = await ingestCards(db, batch.reviews, ctx);
    await recordRun(db, {
      _id: `import-${path.basename(file)}-${started.getTime()}`,
      property: batch.property,
      mode: 'import',
      source: batch.source || 'import',
      status: res.rejected ? 'partial' : 'success',
      startedAt: collectedAt,
      finishedAt: collectedAt,
      durationMs: Date.now() - started,
      pagesRead: batch.pagesRead ?? null,
      cardsSeen: batch.reviews.length,
      newReviews: res.newCount,
      rejected: res.rejected,
      duplicatesInBatch: res.duplicatesInBatch,
      header: batch.header || null,
      warnings: res.problems.slice(0, 50),
      error: null,
      file: path.basename(file),
    });
    await updateProperty(db, batch.property, { header: batch.header, collectedAt, success: true });
    console.log(`${path.basename(file)}: ${batch.reviews.length} cards → ${res.newCount} new, ${res.existing} already stored, ${res.duplicatesInBatch} duplicates in file, ${res.rejected} rejected`);
  } catch (err) {
    failed++;
    console.error(`${file}: FAILED — ${err.message}`);
  }
}
await closeDb();
process.exit(failed ? 1 : 0);
