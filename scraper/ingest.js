/**
 * Shared by the scraper and the importer: validate + normalise a batch of
 * raw cards, drop in-batch duplicates, and upsert.
 */
import { normalizeReview } from '../lib/normalize.js';
import { upsertReviews } from './store.js';

/**
 * @returns {Promise<{newCount: number, existing: number, rejected: number, duplicatesInBatch: number, problems: string[]}>}
 */
export async function ingestCards(db, cards, ctx, { dryRun = false } = {}) {
  const docs = new Map();
  const problems = [];
  let rejected = 0;
  let duplicatesInBatch = 0;
  for (const raw of cards) {
    const res = normalizeReview(raw, ctx);
    if (!res.ok) {
      rejected++;
      problems.push(`rejected review: ${res.errors.join('; ')}`);
      continue;
    }
    for (const w of res.warnings) if (w !== 'hotel reply truncated') problems.push(w);
    if (docs.has(res.review._id)) duplicatesInBatch++;
    docs.set(res.review._id, res.review);
  }
  if (dryRun || !db) return { newCount: docs.size, existing: 0, rejected, duplicatesInBatch, problems };
  const { inserted, existing } = await upsertReviews(db, [...docs.values()], { now: ctx.now });
  return { newCount: inserted, existing, rejected, duplicatesInBatch, problems };
}
