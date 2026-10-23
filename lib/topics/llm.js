/**
 * Optional LLM topic classifier (Claude via the Anthropic Messages API).
 *
 * Why offer it: keywords miss paraphrase ("my feet were black after the
 * shower"), sarcasm and languages we have no word lists for. Why it is not
 * the default: it costs money, needs a key and network, and is harder to
 * audit. The output contract is identical to the keyword classifier, so the
 * dashboard does not care which one produced a tag.
 *
 * Safeguards:
 *  - The model can only choose from the fixed topic ids; anything else is dropped.
 *  - Output must be valid JSON for every review id sent, otherwise that
 *    batch is retried once and then falls back to the keyword classifier.
 *  - Results are stored with `method: "llm"` and a prompt version, so a
 *    re-run only re-classifies reviews whose version is out of date.
 */
import { TOPICS, TOPIC_IDS } from './taxonomy.js';
import { classifyKeyword } from './keyword.js';

export const LLM_CLASSIFIER_VERSION = 'llm-1';
const API_URL = 'https://api.anthropic.com/v1/messages';
const BATCH_SIZE = 20;

export function llmAvailable() {
  return !!process.env.ANTHROPIC_API_KEY;
}

function buildPrompt(batch) {
  const topicList = TOPICS.map((t) => `- ${t.id}: ${t.description}`).join('\n');
  const reviews = batch.map((r) => ({
    id: r._id,
    score: r.score,
    title: r.title || null,
    liked: r.positive || null,
    disliked: r.negative || null,
  }));
  return `You tag hotel guest reviews with operational topics for a hotel operations team.

Topics (use these ids only):
${topicList}

Each review has a "liked" answer and a "disliked" answer, written by the guest, in any language.
For each review return:
- "complaints": topics the guest criticises. Mostly from "disliked", but include criticism written in "liked" or "title" (e.g. liked: "Nothing, filthiest place ever").
- "praise": topics the guest is positive about. Mostly from "liked", but include praise written in "disliked" (e.g. disliked: "Quiet room and lots of privacy").
- A topic must be clearly referred to. Do not infer topics from the score alone. "Nothing", "everything was great" and similar are not topics.
- Use [] when nothing applies.

Return ONLY a JSON array, no prose, one object per review, in the same order:
[{"id": "...", "complaints": ["..."], "praise": ["..."]}]

Reviews:
${JSON.stringify(reviews, null, 1)}`;
}

function parseResponse(text, batch) {
  const start = text.indexOf('[');
  const end = text.lastIndexOf(']');
  if (start === -1 || end === -1) throw new Error('no JSON array in response');
  const arr = JSON.parse(text.slice(start, end + 1));
  if (!Array.isArray(arr)) throw new Error('response is not an array');
  const byId = new Map(arr.map((x) => [x?.id, x]));
  const valid = new Set(TOPIC_IDS);
  const clean = (list) => TOPIC_IDS.filter((id) => Array.isArray(list) && list.includes(id) && valid.has(id));
  const out = new Map();
  for (const r of batch) {
    const item = byId.get(r._id);
    if (!item) throw new Error(`missing result for ${r._id}`);
    out.set(r._id, {
      complaints: clean(item.complaints),
      praise: clean(item.praise),
      evidence: null,
      nothingToDislike: false,
      method: 'llm',
      version: LLM_CLASSIFIER_VERSION,
    });
  }
  return out;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function callApi(prompt, { model, attempt = 1 } = {}) {
  const res = await fetch(API_URL, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': process.env.ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({ model, max_tokens: 4000, temperature: 0, messages: [{ role: 'user', content: prompt }] }),
  });
  if ((res.status === 429 || res.status >= 500) && attempt < 5) {
    const wait = Number(res.headers.get('retry-after')) * 1000 || 2 ** attempt * 1000;
    await sleep(wait);
    return callApi(prompt, { model, attempt: attempt + 1 });
  }
  if (!res.ok) throw new Error(`Anthropic API ${res.status}: ${(await res.text()).slice(0, 300)}`);
  const body = await res.json();
  return body.content?.map((c) => c.text || '').join('') ?? '';
}

/**
 * @param {object[]} reviews normalised review documents
 * @param {{model?: string, onProgress?: (done: number, total: number) => void}} opts
 * @returns {Promise<Map<string, object>>} review id -> classification
 */
export async function classifyWithLlm(reviews, opts = {}) {
  const model = opts.model || process.env.LLM_MODEL || 'claude-haiku-5-5';
  const results = new Map();
  const withText = reviews.filter((r) => r.positive || r.negative || r.title);
  for (let i = 0; i < withText.length; i += BATCH_SIZE) {
    const batch = withText.slice(i, i + BATCH_SIZE);
    let parsed = null;
    for (let attempt = 1; attempt <= 2 && !parsed; attempt++) {
      try {
        parsed = parseResponse(await callApi(buildPrompt(batch), { model }), batch);
      } catch (err) {
        if (attempt === 2) {
          console.warn(`LLM batch ${i / BATCH_SIZE + 1} failed (${err.message}); using keyword classifier for it`);
        }
      }
    }
    for (const r of batch) results.set(r._id, parsed?.get(r._id) ?? classifyKeyword(r));
    opts.onProgress?.(Math.min(i + BATCH_SIZE, withText.length), withText.length);
  }
  return results;
}

// Exported for unit tests.
export const _internal = { buildPrompt, parseResponse };
