/**
 * Database reads used by the dashboard pages, plus parsing of the URL
 * filters (?property=&period=&from=&to=), so every page shares one
 * definition of "the current selection".
 */
import { getDb } from './db.js';
import { PROPERTIES, PROPERTY_BY_SLUG } from '../config/properties.js';
import { addDays, todayInSydney, sydneyDateOf, weekStart } from './dates.js';
import { TOPIC_IDS } from './topics/taxonomy.js';

export const PERIODS = [
  { id: '4w', label: 'Last 4 weeks', weeks: 4 },
  { id: '12w', label: 'Last 12 weeks', weeks: 12 },
  { id: '26w', label: 'Last 6 months', weeks: 26 },
  { id: '52w', label: 'Last 12 months', weeks: 52 },
  { id: 'custom', label: 'Custom dates' },
];

const ISO = /^\d{4}-\d{2}-\d{2}$/;

/**
 * "As of" date: the Sydney date of the latest successful collection, so the
 * dashboard's "this week" means the week the data actually covers. In daily
 * use that is today; with the bundled sample data it is the sample date.
 */
export async function getAsOf(db) {
  const latest = await db.collection('properties').find({ lastSuccessAt: { $ne: null } }).sort({ lastSuccessAt: -1 }).limit(1).next();
  const today = todayInSydney();
  if (!latest) return { asOf: today, lastCollectedAt: null, stale: true };
  const asOf = sydneyDateOf(latest.lastSuccessAt);
  return { asOf: asOf > today ? today : asOf, lastCollectedAt: latest.lastSuccessAt, stale: asOf < addDays(today, -2) };
}

export function parseFilters(searchParams, asOf) {
  const sp = searchParams || {};
  const one = (k) => (Array.isArray(sp[k]) ? sp[k][0] : sp[k]);
  const property = PROPERTY_BY_SLUG[one('property')] ? one('property') : 'all';
  let period = PERIODS.some((p) => p.id === one('period')) ? one('period') : '12w';
  let from;
  let to = asOf;
  if (period === 'custom' && ISO.test(one('from') || '') && ISO.test(one('to') || '')) {
    from = one('from');
    to = one('to');
    if (from > to) [from, to] = [to, from];
  } else {
    if (period === 'custom') period = '12w';
    const weeks = PERIODS.find((p) => p.id === period).weeks;
    from = addDays(weekStart(asOf), -7 * (weeks - 1));
  }
  return { property, period, from, to, properties: property === 'all' ? PROPERTIES : [PROPERTY_BY_SLUG[property]] };
}

const ANALYTIC_FIELDS = { property: 1, reviewDate: 1, score: 1, sentiment: 1, hasText: 1, positive: 1, negative: 1, 'topics.complaints': 1, 'topics.praise': 1, 'topics.nothingToDislike': 1 };

/** Reviews needed for the overview: the selected period plus enough history for week-over-week and period-over-period comparisons. */
export async function getAnalyticsReviews(db, { property, from, to, asOf }) {
  const days = Math.round((Date.parse(to) - Date.parse(from)) / 86400000) + 1;
  const earliest = [addDays(from, -days), addDays(weekStart(asOf), -7)].sort()[0];
  const latest = [to, asOf].sort()[1];
  const q = { reviewDate: { $gte: earliest, $lte: latest } };
  if (property !== 'all') q.property = property;
  return db.collection('reviews').find(q, { projection: ANALYTIC_FIELDS }).toArray();
}

export async function getPropertyMeta(db) {
  const rows = await db.collection('properties').find({}).toArray();
  return Object.fromEntries(rows.map((r) => [r._id, r]));
}

const FEED_SORTS = {
  newest: { reviewDate: -1, _id: 1 },
  oldest: { reviewDate: 1, _id: 1 },
  lowest: { score: 1, reviewDate: -1 },
  highest: { score: -1, reviewDate: -1 },
};

const escapeRegex = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

export function parseFeedFilters(searchParams) {
  const sp = searchParams || {};
  const one = (k) => (Array.isArray(sp[k]) ? sp[k][0] : sp[k]) || '';
  return {
    sentiment: ['positive', 'neutral', 'negative'].includes(one('sentiment')) ? one('sentiment') : '',
    complaint: TOPIC_IDS.includes(one('complaint')) ? one('complaint') : '',
    praise: TOPIC_IDS.includes(one('praise')) ? one('praise') : '',
    text: ['with', 'without'].includes(one('text')) ? one('text') : '',
    replied: ['yes', 'no'].includes(one('replied')) ? one('replied') : '',
    q: one('q').slice(0, 100),
    sort: FEED_SORTS[one('sort')] ? one('sort') : 'newest',
    page: Math.max(1, Math.min(1000, parseInt(one('page'), 10) || 1)),
  };
}

export async function getFeed(db, filters, feed, pageSize = 20) {
  const q = { reviewDate: { $gte: filters.from, $lte: filters.to } };
  if (filters.property !== 'all') q.property = filters.property;
  if (feed.sentiment) q.sentiment = feed.sentiment;
  if (feed.complaint) q['topics.complaints'] = feed.complaint;
  if (feed.praise) q['topics.praise'] = feed.praise;
  if (feed.text === 'with') q.hasText = true;
  if (feed.text === 'without') q.hasText = false;
  if (feed.replied) q.hasHotelReply = feed.replied === 'yes';
  if (feed.q) {
    const re = { $regex: escapeRegex(feed.q), $options: 'i' };
    q.$or = [{ positive: re }, { negative: re }, { title: re }];
  }
  const col = db.collection('reviews');
  const [total, items] = await Promise.all([
    col.countDocuments(q),
    col.find(q).sort(FEED_SORTS[feed.sort]).skip((feed.page - 1) * pageSize).limit(pageSize).toArray(),
  ]);
  return { total, items, pageSize, pages: Math.max(1, Math.ceil(total / pageSize)) };
}

export async function getRuns(db, limit = 40) {
  return db.collection('scrape_runs').find({}).sort({ startedAt: -1 }).limit(limit).toArray();
}

export async function getQualityStats(db) {
  const col = db.collection('reviews');
  const [byProperty, totals, langs, methods] = await Promise.all([
    col.aggregate([
      { $group: { _id: '$property', n: { $sum: 1 }, earliest: { $min: '$reviewDate' }, latest: { $max: '$reviewDate' }, withText: { $sum: { $cond: ['$hasText', 1, 0] } }, replied: { $sum: { $cond: ['$hasHotelReply', 1, 0] } } } },
    ]).toArray(),
    col.aggregate([
      { $group: {
        _id: null,
        n: { $sum: 1 },
        withText: { $sum: { $cond: ['$hasText', 1, 0] } },
        truncatedReplies: { $sum: { $cond: ['$hotelReplyTruncated', 1, 0] } },
        possibleDuplicates: { $sum: { $cond: [{ $ifNull: ['$possibleDuplicateOf', false] }, 1, 0] } },
        nothingToDislike: { $sum: { $cond: ['$topics.nothingToDislike', 1, 0] } },
        untagged: { $sum: { $cond: [{ $and: ['$hasText', { $eq: [{ $size: { $ifNull: ['$topics.complaints', []] } }, 0] }, { $eq: [{ $size: { $ifNull: ['$topics.praise', []] } }, 0] }] }, 1, 0] } },
      } },
    ]).toArray(),
    col.aggregate([{ $match: { hasText: true } }, { $group: { _id: '$language', n: { $sum: 1 } } }, { $sort: { n: -1 } }]).toArray(),
    col.aggregate([{ $group: { _id: { method: '$topics.method', version: '$topics.version' }, n: { $sum: 1 } } }]).toArray(),
  ]);
  return { byProperty: Object.fromEntries(byProperty.map((r) => [r._id, r])), totals: totals[0] || { n: 0 }, langs, methods };
}

export { getDb };
