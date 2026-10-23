import { test } from 'node:test';
import assert from 'node:assert/strict';
import { classifyKeyword, isNothingToDislike, topicsInText } from '../lib/topics/keyword.js';
import { detectLanguage } from '../lib/language.js';
import { _internal } from '../lib/topics/llm.js';

const cls = (positive, negative, extra = {}) => classifyKeyword({ positive, negative, language: detectLanguage([positive, negative].filter(Boolean).join(' ')), ...extra });

test('liked text becomes praise, disliked text becomes complaints', () => {
  const r = cls('Great location, friendly staff', 'Dirty bathroom and noisy at night');
  assert.deepEqual(r.praise.sort(), ['location', 'staff']);
  assert.ok(r.complaints.includes('cleanliness'));
  assert.ok(r.complaints.includes('noise'));
});

test('"nothing" answers are not complaints, and "nothing" in liked is not praise', () => {
  for (const t of ['Nothing', 'Nothing, everything was great!', 'nothing to complain about', 'All good', 'N/A', 'No complaints']) {
    assert.equal(isNothingToDislike(t), true, t);
  }
  assert.equal(isNothingToDislike('Nothing worked, the shower was broken'), false);
  const r = cls('ABSOLUTELY NOTHING. FILTHIEST PLACE EVER', 'Filthy room');
  assert.deepEqual(r.praise, []);
  assert.ok(r.complaints.includes('cleanliness'));
});

test('weak nouns only count without a stronger signal in the same clause', () => {
  assert.deepEqual(Object.keys(topicsInText('The bathroom was dirty')), ['cleanliness']);
  assert.ok(topicsInText('Only one bathroom for the whole floor').facilities);
});

test('critical topics and other languages', () => {
  assert.ok(cls(null, 'Cockroaches in the kitchen').complaints.includes('pests'));
  assert.ok(cls(null, 'I did not feel safe, people using drugs outside').complaints.includes('safety'));
  assert.ok(cls('位置比较好', '噪音比较大').complaints.includes('noise'));
  assert.ok(cls('位置比较好', '噪音比较大').praise.includes('location'));
  assert.ok(cls(null, 'Los baños muy sucios').complaints.includes('cleanliness'));
});

test('English text never fires foreign word lists', () => {
  assert.deepEqual(cls(null, 'The carousel outside was fun').complaints, []);
});

test('rating-only reviews use the title, with polarity from the score', () => {
  const r = classifyKeyword({ title: 'Dirty bathrooms, no lift', sentiment: 'negative', language: 'en' });
  assert.ok(r.complaints.includes('cleanliness'));
  assert.ok(r.complaints.includes('facilities'));
});

test('LLM output is validated against the topic list', () => {
  const batch = [{ _id: 'a' }, { _id: 'b' }];
  const out = _internal.parseResponse('Here you go: [{"id":"a","complaints":["cleanliness","made-up"],"praise":[]},{"id":"b","complaints":[],"praise":["location"]}]', batch);
  assert.deepEqual(out.get('a').complaints, ['cleanliness']);
  assert.deepEqual(out.get('b').praise, ['location']);
  assert.throws(() => _internal.parseResponse('[{"id":"a","complaints":[],"praise":[]}]', batch), /missing result/);
});
