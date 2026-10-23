#!/usr/bin/env node
/**
 * Measures the topic classifier against the hand-labelled spot-check set.
 *
 *   npm run eval            # keyword classifier
 *   npm run eval -- --llm   # LLM classifier (needs ANTHROPIC_API_KEY)
 *   npm run eval -- --verbose   # also list every disagreement
 *   npm run eval -- --set=gold  # the development set the rules were tuned on (default: holdout)
 *
 * Runs entirely from data/raw/*.json, so no database is required.
 */
import '../lib/env.js';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { normalizeReview } from '../lib/normalize.js';
import { classifyKeyword } from '../lib/topics/keyword.js';
import { classifyWithLlm, llmAvailable } from '../lib/topics/llm.js';
import { TOPICS } from '../lib/topics/taxonomy.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const useLlm = args.includes('--llm');
const verbose = args.includes('--verbose');
const setName = (args.find((a) => a.startsWith('--set=')) || '--set=holdout').slice(6);
const setFile = { holdout: 'topic-holdout.json', gold: 'topic-gold.json' }[setName];
if (!setFile) {
  console.error('--set must be "holdout" or "gold"');
  process.exit(1);
}

const gold = JSON.parse(fs.readFileSync(path.join(root, 'data/eval', setFile), 'utf8')).items;
const wanted = new Set(gold.map((g) => g.id));

const reviews = new Map();
const rawDir = path.join(root, 'data/raw');
for (const file of fs.readdirSync(rawDir).filter((f) => f.endsWith('.json'))) {
  const batch = JSON.parse(fs.readFileSync(path.join(rawDir, file), 'utf8'));
  for (const raw of batch.reviews) {
    const res = normalizeReview(raw, { property: batch.property, collectedAt: batch.collectedAt });
    if (res.ok && wanted.has(res.review._id)) reviews.set(res.review._id, res.review);
  }
}
const missing = gold.filter((g) => !reviews.has(g.id));
if (missing.length) console.warn(`warning: ${missing.length} labelled reviews not found in data/raw`);

if (useLlm && !llmAvailable()) {
  console.error('Set ANTHROPIC_API_KEY to evaluate the LLM classifier.');
  process.exit(1);
}

const items = gold.filter((g) => reviews.has(g.id));
const predictions = new Map();
if (useLlm) {
  const out = await classifyWithLlm(items.map((g) => reviews.get(g.id)));
  for (const [id, result] of out) predictions.set(id, result);
} else {
  for (const g of items) predictions.set(g.id, classifyKeyword(reviews.get(g.id)));
}

const stats = {};
const disagreements = [];
for (const polarity of ['complaints', 'praise']) {
  for (const t of TOPICS) stats[`${polarity}:${t.id}`] = { tp: 0, fp: 0, fn: 0 };
}
for (const g of items) {
  const pred = predictions.get(g.id);
  if (!pred) continue;
  for (const polarity of ['complaints', 'praise']) {
    const want = new Set(g[polarity]);
    const got = new Set(pred[polarity]);
    for (const t of TOPICS) {
      const s = stats[`${polarity}:${t.id}`];
      if (want.has(t.id) && got.has(t.id)) s.tp++;
      else if (got.has(t.id)) { s.fp++; disagreements.push({ id: g.id, polarity, topic: t.id, kind: 'extra' }); }
      else if (want.has(t.id)) { s.fn++; disagreements.push({ id: g.id, polarity, topic: t.id, kind: 'missed' }); }
    }
  }
}

const pct = (x) => (Number.isFinite(x) ? `${Math.round(x * 100)}%` : '  –');
function summarise(polarity) {
  console.log(`\n${polarity === 'complaints' ? 'COMPLAINTS (disliked text)' : 'PRAISE (liked text)'}`);
  console.log('topic                    labelled  precision  recall');
  let TP = 0, FP = 0, FN = 0;
  for (const t of TOPICS) {
    const s = stats[`${polarity}:${t.id}`];
    TP += s.tp; FP += s.fp; FN += s.fn;
    const p = s.tp / (s.tp + s.fp);
    const r = s.tp / (s.tp + s.fn);
    console.log(`${t.label.padEnd(25)}${String(s.tp + s.fn).padStart(8)}  ${pct(p).padStart(9)}  ${pct(r).padStart(6)}`);
  }
  const p = TP / (TP + FP);
  const r = TP / (TP + FN);
  console.log(`${'ALL (micro-average)'.padEnd(25)}${String(TP + FN).padStart(8)}  ${pct(p).padStart(9)}  ${pct(r).padStart(6)}  F1 ${pct((2 * p * r) / (p + r))}`);
  return { precision: p, recall: r };
}

console.log(`Classifier: ${useLlm ? 'LLM' : 'keyword'} — ${setName} set, ${items.length} labelled reviews`);
const c = summarise('complaints');
const p = summarise('praise');

if (verbose) {
  console.log('\nDisagreements:');
  for (const d of disagreements) {
    const r = reviews.get(d.id);
    const text = d.polarity === 'complaints' ? r.negative : r.positive;
    const ev = predictions.get(d.id).evidence?.[d.polarity]?.[d.topic];
    console.log(`- [${d.kind}] ${d.polarity}/${d.topic}${ev ? ` (matched: ${ev.join(', ')})` : ''}: ${String(text || r.title).slice(0, 140)}`);
  }
}

const reportPath = path.join(root, 'data/eval', `report-${useLlm ? 'llm' : 'keyword'}-${setName}.json`);
fs.writeFileSync(reportPath, JSON.stringify({ generatedAt: new Date().toISOString(), set: setName, n: items.length, complaints: c, praise: p, perTopic: stats }, null, 2));
console.log(`\nSaved ${path.relative(root, reportPath)}`);
