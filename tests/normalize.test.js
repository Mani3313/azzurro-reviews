import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseScore, parseNights, normalizeReview, fingerprint, reviewerKey } from '../lib/normalize.js';
import { parseReviewDate, parseStayMonth } from '../lib/dates.js';
import { parseHeader } from '../scraper/store.js';

const raw = {
  reviewerName: 'Sam', reviewerCountry: 'Australia', roomType: 'Standard Double Room (Ensuite)',
  nights: '1 night ·', stayDate: 'October 2026', travellerType: 'Couple',
  reviewDate: 'Reviewed: 16 October 2026', title: 'Very good', score: 'Scored 8.0 8.0',
  positive: 'Location was perfect', negative: 'The pub was loud', hotelReply: null,
};
const ctx = { property: 'olympic-paddington', collectedAt: '2026-10-23T00:00:00Z' };

test('parses Booking.com score strings', () => {
  assert.equal(parseScore('Scored 8.0 8.0'), 8);
  assert.equal(parseScore('Scored 10 10'), 10);
  assert.equal(parseScore('Scored 7,5'), 7.5);
  assert.equal(parseScore('Scored 0'), null);
  assert.equal(parseScore(null), null);
});

test('parses dates and stay info', () => {
  assert.equal(parseReviewDate('Reviewed: 3 October 2026'), '2026-10-03');
  assert.equal(parseReviewDate('Reviewed: 31 February 2026'), null);
  assert.equal(parseReviewDate('Beoordeeld: 3 oktober 2026'), null); // non-English page is rejected, not misread
  assert.equal(parseStayMonth('September 2026'), '2026-09');
  assert.equal(parseNights('14 nights ·'), 14);
});

test('parses the overall score header', () => {
  assert.deepEqual(parseHeader('Scored 6.4 6.4Rated pleasant 2,444 reviews Pleasant'), { score: 6.4, count: 2444 });
  assert.deepEqual(parseHeader(null), { score: null, count: null });
});

test('normalises a review and never stores the name', () => {
  const res = normalizeReview(raw, ctx);
  assert.equal(res.ok, true);
  const r = res.review;
  assert.equal(r.reviewDate, '2026-10-16');
  assert.equal(r.score, 8);
  assert.equal(r.sentiment, 'positive');
  assert.equal(r.stayMonth, '2026-10');
  assert.equal(r.reviewerKey, reviewerKey('Sam'));
  assert.ok(!('reviewerName' in r));
  assert.equal(JSON.stringify(r).includes('Sam'), false);
});

test('rejects reviews missing core fields or dated in the future', () => {
  assert.equal(normalizeReview({ ...raw, score: 'n/a' }, ctx).ok, false);
  assert.equal(normalizeReview({ ...raw, reviewDate: 'yesterday' }, ctx).ok, false);
  assert.equal(normalizeReview({ ...raw, reviewDate: 'Reviewed: 1 December 2026' }, ctx).ok, false);
  assert.equal(normalizeReview(raw, { ...ctx, property: 'nope' }).ok, false);
});

test('fingerprint is stable across whitespace and reply changes, and sensitive to content', () => {
  const a = normalizeReview(raw, ctx).review;
  const b = normalizeReview({ ...raw, positive: '  Location   was perfect ', hotelReply: 'Thanks!' }, ctx).review;
  const c = normalizeReview({ ...raw, negative: 'The pub was very loud' }, ctx).review;
  assert.equal(a._id, b._id);
  assert.notEqual(a._id, c._id);
  assert.equal(fingerprint(a), a._id);
});

test('treats Booking.com "no comments" placeholder as no text and flags truncated replies', () => {
  const r = normalizeReview({ ...raw, positive: 'There are no comments available for this review', negative: null, hotelReply: 'Thank you for...' }, ctx);
  assert.equal(r.review.hasText, false);
  assert.equal(r.review.hotelReplyTruncated, true);
  assert.ok(r.warnings.includes('hotel reply truncated'));
});
