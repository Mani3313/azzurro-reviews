/**
 * Turns a raw scraped review card (strings exactly as rendered) into a
 * validated review document. This is the single data-quality gate: the
 * Playwright scraper and the JSON importer both go through it, so every
 * review in the database obeys the same rules.
 */
import { createHash } from 'node:crypto';
import { PROPERTY_BY_SLUG } from '../config/properties.js';
import { parseReviewDate, parseStayMonth } from './dates.js';
import { detectLanguage } from './language.js';

const clean = (s) => {
  if (s == null) return null;
  const t = String(s).replace(/\s+/g, ' ').trim();
  return t || null;
};

/** Hotel replies are truncated in the list view until "Continue reading" is clicked. */
const isTruncatedReply = (s) => /(\.\.\.|…)$/.test(s);

/** Booking.com shows "There are no comments available for this review" for rating-only reviews. */
const NO_COMMENT = /^there are no comments available/i;

/**
 * One-way hash of the displayed reviewer name, so we never store names.
 * Booking.com shows first names only ("Sam"), so this is NOT a unique guest
 * id: it is just one more ingredient of the review fingerprint.
 */
export function reviewerKey(name) {
  const n = clean(name);
  if (!n) return null;
  return createHash('sha256').update(n.toLowerCase()).digest('hex').slice(0, 16);
}

/** "Scored 8.0 8.0" / "Scored 10 10" -> 8 / 10. */
export function parseScore(raw) {
  const m = clean(raw)?.match(/(\d{1,2}(?:[.,]\d)?)/);
  if (!m) return null;
  const n = Number(m[1].replace(',', '.'));
  return n >= 1 && n <= 10 ? n : null;
}

/** "3 nights ·" -> 3. */
export function parseNights(raw) {
  const m = clean(raw)?.match(/(\d+)\s*night/i);
  return m ? Number(m[1]) : null;
}

/** Booking.com's own score bands, used for the positive / neutral / negative split. */
export function sentimentForScore(score) {
  if (score == null) return null;
  if (score >= 8) return 'positive';
  if (score <= 5) return 'negative';
  return 'neutral';
}

const norm = (s) => (s || '').toLowerCase().replace(/\s+/g, ' ').trim();

/**
 * Stable identity for a review. Booking.com exposes no review id in the
 * markup, so we hash the fields that never change after publication. The
 * hotel's reply is deliberately excluded (it can be added later), as is the
 * reviewer name (we only keep its hash, which is included).
 */
export function fingerprint(r) {
  const parts = [
    r.property, r.reviewDate, r.reviewerKey, r.score, norm(r.title), norm(r.positive), norm(r.negative),
    norm(r.roomType), r.stayMonth, r.nights, norm(r.travellerType), norm(r.reviewerCountry),
  ];
  return createHash('sha256').update(parts.map((p) => (p == null ? '' : String(p))).join('␟')).digest('hex').slice(0, 24);
}

/**
 * @param {object} raw  fields from scraper/extract.js
 * @param {object} ctx  { property, source, sourceUrl, collectedAt }
 * @returns {{ ok: true, review: object, warnings: string[] } | { ok: false, errors: string[] }}
 */
export function normalizeReview(raw, ctx) {
  const errors = [];
  const warnings = [];

  if (!PROPERTY_BY_SLUG[ctx.property]) errors.push(`unknown property "${ctx.property}"`);
  const score = parseScore(raw.score);
  if (score == null) errors.push(`unparseable score "${raw.score}"`);
  const reviewDate = parseReviewDate(raw.reviewDate);
  if (!reviewDate) errors.push(`unparseable review date "${raw.reviewDate}"`);
  const collectedDay = (ctx.collectedAt ? new Date(ctx.collectedAt) : new Date()).toISOString().slice(0, 10);
  if (reviewDate && reviewDate > collectedDay) {
    // Allow one day of slack for the Sydney/UTC offset.
    const d = new Date(`${collectedDay}T00:00:00Z`);
    d.setUTCDate(d.getUTCDate() + 1);
    if (reviewDate > d.toISOString().slice(0, 10)) errors.push(`review date ${reviewDate} is in the future`);
  }
  if (errors.length) return { ok: false, errors };

  let positive = clean(raw.positive);
  let negative = clean(raw.negative);
  if (positive && NO_COMMENT.test(positive)) positive = null;
  if (negative && NO_COMMENT.test(negative)) negative = null;

  let hotelReply = clean(raw.hotelReply);
  const hotelReplyTruncated = !!hotelReply && isTruncatedReply(hotelReply);
  if (hotelReplyTruncated) warnings.push('hotel reply truncated');

  const stayMonth = parseStayMonth(raw.stayDate);
  if (raw.stayDate && !stayMonth) warnings.push(`unparseable stay date "${raw.stayDate}"`);

  const key = raw.reviewerKey ?? reviewerKey(raw.reviewerName);
  const textForLang = [positive, negative].filter(Boolean).join(' ') || null;

  const review = {
    property: ctx.property,
    reviewDate,
    score,
    sentiment: sentimentForScore(score),
    title: clean(raw.title),
    positive,
    negative,
    hasText: !!(positive || negative),
    language: detectLanguage(textForLang),
    hotelReply,
    hotelReplyTruncated,
    hasHotelReply: !!hotelReply,
    reviewerKey: key,
    reviewerCountry: clean(raw.reviewerCountry),
    travellerType: clean(raw.travellerType),
    roomType: clean(raw.roomType),
    nights: parseNights(raw.nights),
    stayMonth,
  };
  review._id = fingerprint(review);
  review.source = ctx.source || 'scraper';
  review.sourceUrl = ctx.sourceUrl || null;
  return { ok: true, review, warnings };
}
