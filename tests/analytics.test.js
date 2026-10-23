import { test } from 'node:test';
import assert from 'node:assert/strict';
import { weekStart, addDays } from '../lib/dates.js';
import { weekComparison, weeklySeries, topicStats, buildInsights } from '../lib/analytics.js';

const rv = (reviewDate, score, extra = {}) => ({
  property: 'olympic-paddington', reviewDate, score,
  sentiment: score >= 8 ? 'positive' : score <= 5 ? 'negative' : 'neutral',
  hasText: true, negative: 'x', topics: { complaints: [], praise: [] }, ...extra,
});

test('weeks start on Monday', () => {
  assert.equal(weekStart('2026-10-23'), '2026-10-19'); // Friday -> Monday
  assert.equal(weekStart('2026-10-19'), '2026-10-19');
  assert.equal(weekStart('2026-10-25'), '2026-10-19'); // Sunday
  assert.equal(addDays('2026-12-31', 1), '2027-01-01');
});

test('this week vs last week', () => {
  const reviews = [rv('2026-10-20', 8), rv('2026-10-22', 6), rv('2026-10-13', 4), rv('2026-10-18', 6), rv('2026-10-05', 10)];
  const c = weekComparison(reviews, '2026-10-23');
  assert.equal(c.current.n, 2);
  assert.equal(c.current.avg, 7);
  assert.equal(c.previous.n, 2);
  assert.equal(c.previous.avg, 5);
  assert.equal(c.avgChange, 2);
  assert.equal(c.lowSample, true);
});

test('weekly series includes empty weeks as gaps', () => {
  const s = weeklySeries([rv('2026-10-01', 8), rv('2026-10-20', 6)], '2026-09-28', '2026-10-23', ['olympic-paddington']);
  assert.equal(s.length, 4);
  assert.equal(s[1].avg, null);
  assert.equal(s[1]['avg_olympic-paddington'], null);
  assert.equal(s[3].partial, true);
});

test('topic shares only count reviews with comments', () => {
  const reviews = [
    rv('2026-10-20', 2, { topics: { complaints: ['cleanliness'], praise: [] } }),
    rv('2026-10-20', 3, { topics: { complaints: ['noise'], praise: [] } }),
    rv('2026-10-20', 1, { hasText: false, negative: null }), // rating only: excluded from denominator
  ];
  const clean = topicStats(reviews).find((t) => t.id === 'cleanliness');
  assert.equal(clean.negativeWithText, 2);
  assert.equal(clean.complaintShareOfNegative, 0.5);
});

test('insights use counts, not percentages, for tiny samples, and always surface urgent topics', () => {
  const reviews = [rv('2026-10-20', 2, { topics: { complaints: ['cleanliness', 'pests'], praise: [] } })];
  const ins = buildInsights(reviews, { asOf: '2026-10-23' });
  assert.ok(ins.some((i) => /1 of the 1 negative review/.test(i.text)));
  assert.ok(ins.some((i) => i.tone === 'critical' && i.topic === 'pests'));
  assert.ok(!ins.some((i) => /100%/.test(i.text)));
});
