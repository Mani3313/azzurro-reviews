#!/usr/bin/env node
/**
 * (Re)classify stored reviews into topics.
 *
 *   npm run classify             # keyword rules; only reviews tagged by an older rule version
 *   npm run classify -- --force  # keyword rules on every review
 *   npm run classify -- --llm    # Claude for reviews with text (needs ANTHROPIC_API_KEY)
 *
 * New reviews are already keyword-classified on insert; this is for rule
 * changes and for upgrading to the LLM classifier.
 */
import '../lib/env.js';
import { getDb, closeDb } from '../lib/db.js';
import { classifyKeyword, KEYWORD_CLASSIFIER_VERSION } from '../lib/topics/keyword.js';
import { classifyWithLlm, llmAvailable, LLM_CLASSIFIER_VERSION } from '../lib/topics/llm.js';

const args = process.argv.slice(2);
const useLlm = args.includes('--llm');
const force = args.includes('--force');

if (useLlm && !llmAvailable()) {
  console.error('ANTHROPIC_API_KEY is not set. Add it to .env.local (see .env.example) or run without --llm.');
  process.exit(2);
}

const db = await getDb();
const col = db.collection('reviews');
const version = useLlm ? LLM_CLASSIFIER_VERSION : KEYWORD_CLASSIFIER_VERSION;
const filter = force ? {} : { 'topics.version': { $ne: version } };
if (useLlm) filter.hasText = true;
const reviews = await col.find(filter).toArray();
console.log(`${reviews.length} reviews to classify with ${useLlm ? 'LLM' : 'keyword rules'} (${version})`);

let results;
if (useLlm) {
  results = await classifyWithLlm(reviews, { onProgress: (d, t) => process.stdout.write(`\r  ${d}/${t}`) });
  process.stdout.write('\n');
} else {
  results = new Map(reviews.map((r) => [r._id, classifyKeyword(r)]));
}

const ops = [...results].map(([id, topics]) => ({ updateOne: { filter: { _id: id }, update: { $set: { topics } } } }));
for (let i = 0; i < ops.length; i += 500) await col.bulkWrite(ops.slice(i, i + 500), { ordered: false });
console.log(`Updated ${ops.length} reviews.`);
await closeDb();
