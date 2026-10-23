/**
 * Persistence for collected reviews. Idempotent: running the same collection
 * twice changes nothing except `lastSeenAt`.
 */
import { classifyKeyword } from '../lib/topics/keyword.js';

/**
 * "Scored 6.8 6.8Rated pleasant 2,444 reviews ..." -> { score: 6.8, count: 2444 }
 * This is Booking.com's own all-time headline for the property; we store it
 * so the dashboard can show coverage (how many of the reviews we hold).
 */
export function parseHeader(header) {
  if (!header) return { score: null, count: null };
  const score = header.match(/Scored\s+(\d+(?:[.,]\d)?)/i);
  const count = header.match(/([\d,.]+)\s+reviews?/i);
  return {
    score: score ? Number(score[1].replace(',', '.')) : null,
    count: count ? Number(count[1].replace(/[,.]/g, '')) : null,
  };
}

/**
 * Upserts normalised reviews.
 * - New reviews are inserted with a keyword classification and firstSeenAt.
 * - Known reviews only get lastSeenAt refreshed, plus the hotel reply if one
 *   has appeared since (a full reply never gets overwritten by a truncated one).
 * @returns {Promise<{inserted: number, existing: number, insertedIds: string[]}>}
 */
export async function upsertReviews(db, reviews, { now = new Date() } = {}) {
  if (!reviews.length) return { inserted: 0, existing: 0, insertedIds: [] };
  const ops = reviews.map((r) => {
    const { hotelReply, hotelReplyTruncated, hasHotelReply, ...immutable } = r;
    const reply = { hotelReply, hotelReplyTruncated, hasHotelReply };
    const replyIsFull = hasHotelReply && !hotelReplyTruncated;
    return {
      updateOne: {
        filter: { _id: r._id },
        update: {
          $setOnInsert: {
            ...immutable,
            ...(replyIsFull ? {} : reply),
            topics: classifyKeyword(r),
            firstSeenAt: now,
          },
          $set: { lastSeenAt: now, ...(replyIsFull ? reply : {}) },
        },
        upsert: true,
      },
    };
  });
  const res = await db.collection('reviews').bulkWrite(ops, { ordered: false });
  const insertedIds = Object.values(res.upsertedIds || {}).map(String);
  if (insertedIds.length) await flagPossibleDuplicates(db, insertedIds);
  return { inserted: res.upsertedCount, existing: reviews.length - res.upsertedCount, insertedIds };
}

/**
 * Booking.com lets guests edit a review. An edited review has new text, so
 * it gets a new fingerprint and would be counted twice. We can't prove an
 * edit, so we flag (never merge or drop) a new review that matches an older
 * one on every stay detail. Booking.com only shows first names, so the
 * reviewer key is weak and genuine repeat guests also match; that's why this
 * is a flag shown on the Data health page, not an exclusion.
 */
async function flagPossibleDuplicates(db, ids) {
  const col = db.collection('reviews');
  const fresh = await col.find({ _id: { $in: ids }, reviewerKey: { $ne: null } }).toArray();
  for (const r of fresh) {
    const twin = await col.findOne({
      _id: { $ne: r._id },
      property: r.property,
      reviewerKey: r.reviewerKey,
      stayMonth: r.stayMonth,
      roomType: r.roomType,
      nights: r.nights,
      travellerType: r.travellerType,
      reviewerCountry: r.reviewerCountry,
      possibleDuplicateOf: { $exists: false },
    }, { sort: { firstSeenAt: 1 }, projection: { _id: 1, firstSeenAt: 1 } });
    if (twin && twin.firstSeenAt < r.firstSeenAt) {
      await col.updateOne({ _id: r._id }, { $set: { possibleDuplicateOf: twin._id } });
    }
  }
}

export async function recordRun(db, run) {
  await db.collection('scrape_runs').insertOne(run);
}

export async function updateProperty(db, slug, { header, collectedAt, success }) {
  const { score, count } = parseHeader(header);
  const set = { lastAttemptAt: collectedAt };
  if (success) set.lastSuccessAt = collectedAt;
  if (score != null) set.bookingScore = score;
  if (count != null) set.bookingReviewCount = count;
  await db.collection('properties').updateOne({ _id: slug }, { $set: set }, { upsert: true });
}
