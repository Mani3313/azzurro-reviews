/**
 * Dashboard maths. Pure functions over arrays of review documents, so they
 * are unit-testable without a database. The data set is small (a few
 * thousand reviews per year across four hotels), so computing in Node after
 * one indexed query is simpler and fast enough; see README "Scaling" for when
 * to move this into MongoDB aggregation pipelines.
 *
 * Definitions (shown to users on the "How it works" page):
 *  - Rating: Booking.com review score, 1–10.
 *  - Positive review: score >= 8. Negative review: score <= 5. Otherwise neutral.
 *  - Week: Monday–Sunday, by the date the review was published, Sydney time.
 *  - "This week" is week-to-date up to the data's as-of date.
 */
import { PROPERTIES } from '../config/properties.js';
import { TOPICS, TOPIC_BY_ID } from './topics/taxonomy.js';
import { addDays, weekStart, formatDay, formatRange } from './dates.js';

/** Below this many reviews a weekly average is flagged as unreliable. */
export const LOW_SAMPLE = 5;

const round1 = (x) => (x == null || Number.isNaN(x) ? null : Math.round(x * 10) / 10);

export function summarise(reviews) {
  const n = reviews.length;
  if (!n) return { n: 0, avg: null, positive: 0, neutral: 0, negative: 0, negativeShare: null, positiveShare: null, withText: 0 };
  let sum = 0, positive = 0, neutral = 0, negative = 0, withText = 0;
  for (const r of reviews) {
    sum += r.score;
    if (r.sentiment === 'positive') positive++;
    else if (r.sentiment === 'negative') negative++;
    else neutral++;
    if (r.hasText) withText++;
  }
  return { n, avg: round1(sum / n), positive, neutral, negative, negativeShare: negative / n, positiveShare: positive / n, withText };
}

export const inRange = (r, from, to) => r.reviewDate >= from && r.reviewDate <= to;

/** The two windows every "this week vs last week" figure uses. */
export function weekWindows(asOf) {
  const thisStart = weekStart(asOf);
  const lastStart = addDays(thisStart, -7);
  return {
    thisWeek: { from: thisStart, to: asOf, label: `This week (${formatRange(thisStart, asOf)})`, short: 'This week' },
    lastWeek: { from: lastStart, to: addDays(thisStart, -1), label: `Last week (${formatRange(lastStart, addDays(thisStart, -1))})`, short: 'Last week' },
  };
}

export function weekComparison(reviews, asOf) {
  const w = weekWindows(asOf);
  const current = summarise(reviews.filter((r) => inRange(r, w.thisWeek.from, w.thisWeek.to)));
  const previous = summarise(reviews.filter((r) => inRange(r, w.lastWeek.from, w.lastWeek.to)));
  return {
    windows: w,
    current,
    previous,
    avgChange: current.avg != null && previous.avg != null ? round1(current.avg - previous.avg) : null,
    lowSample: current.n < LOW_SAMPLE || previous.n < LOW_SAMPLE,
  };
}

/** Weekly buckets from `from` to `to` inclusive, including empty weeks. */
export function weeklySeries(reviews, from, to, properties = PROPERTIES.map((p) => p.slug)) {
  const weeks = [];
  for (let w = weekStart(from); w <= to; w = addDays(w, 7)) weeks.push(w);
  const byWeek = new Map(weeks.map((w) => [w, []]));
  for (const r of reviews) {
    const w = weekStart(r.reviewDate);
    if (byWeek.has(w)) byWeek.get(w).push(r);
  }
  return weeks.map((w) => {
    const list = byWeek.get(w);
    const s = summarise(list);
    const row = { week: w, label: formatDay(w), ...s, partial: addDays(w, 6) > to };
    for (const slug of properties) {
      const ps = summarise(list.filter((r) => r.property === slug));
      row[`avg_${slug}`] = ps.avg;
      row[`n_${slug}`] = ps.n;
    }
    return row;
  });
}

/** Per-property table rows. */
export function propertyBreakdown(reviews, { asOf, from, to, properties, propertyMeta = {} }) {
  const w = weekWindows(asOf);
  return properties.map((p) => {
    const mine = reviews.filter((r) => r.property === p.slug);
    const period = mine.filter((r) => inRange(r, from, to));
    const thisWeek = summarise(mine.filter((r) => inRange(r, w.thisWeek.from, w.thisWeek.to)));
    const lastWeek = summarise(mine.filter((r) => inRange(r, w.lastWeek.from, w.lastWeek.to)));
    const ps = summarise(period);
    const topics = topicStats(period);
    const topComplaint = topics.filter((t) => t.complaints > 0).sort((a, b) => b.complaints - a.complaints)[0] || null;
    const meta = propertyMeta[p.slug] || {};
    return {
      slug: p.slug,
      name: p.name,
      thisWeek,
      lastWeek,
      change: thisWeek.avg != null && lastWeek.avg != null ? round1(thisWeek.avg - lastWeek.avg) : null,
      period: ps,
      topComplaint: topComplaint && { id: topComplaint.id, label: topComplaint.label, share: topComplaint.complaintShareOfNegative, count: topComplaint.complaints },
      bookingScore: meta.bookingScore ?? null,
      bookingReviewCount: meta.bookingReviewCount ?? null,
      lastSuccessAt: meta.lastSuccessAt ?? null,
    };
  });
}

/**
 * Topic statistics for a set of reviews.
 *  complaints           reviews whose disliked text mentions the topic
 *  praise               reviews whose liked text mentions the topic
 *  negativeWithText     negative reviews that have any written text (denominator)
 *  negativeMentioning   of those, how many complain about this topic
 *  complaintShareOfNegative = negativeMentioning / negativeWithText
 *  avgScoreWhenComplained   average score of reviews complaining about it
 */
/**
 * A review "has comments" if the guest wrote liked/disliked text, or wrote a
 * descriptive title on a rating-only review that produced a topic (the
 * classifier reads titles only in that case). Numerators and denominators
 * both use this definition so shares can never exceed what was written.
 */
const hasComments = (r) => r.hasText || r.topics?.complaints?.length > 0 || r.topics?.praise?.length > 0;
const hasComplaintSource = (r) => (r.negative && !r.topics?.nothingToDislike) || r.topics?.complaints?.length > 0;

export function topicStats(reviews) {
  const negativeWithText = reviews.filter((r) => r.sentiment === 'negative' && hasComments(r)).length;
  const withComplaintText = reviews.filter(hasComplaintSource).length;
  return TOPICS.map((t) => {
    let complaints = 0, praise = 0, negativeMentioning = 0, scoreSum = 0;
    for (const r of reviews) {
      const c = r.topics?.complaints?.includes(t.id);
      if (c) {
        complaints++;
        scoreSum += r.score;
        if (r.sentiment === 'negative') negativeMentioning++;
      }
      if (r.topics?.praise?.includes(t.id)) praise++;
    }
    return {
      id: t.id,
      label: t.label,
      critical: !!t.critical,
      complaints,
      praise,
      negativeMentioning,
      negativeWithText,
      complaintShareOfNegative: negativeWithText ? negativeMentioning / negativeWithText : null,
      complaintShareOfAll: withComplaintText ? complaints / withComplaintText : null,
      avgScoreWhenComplained: complaints ? round1(scoreSum / complaints) : null,
      net: praise - complaints,
    };
  });
}

const pct = (x) => `${Math.round(x * 100)}%`;

/**
 * Plain-English insight sentences for operations staff, most important
 * first. Every sentence states its sample size, so nobody acts on "100% of
 * negative reviews" when that means one review.
 */
export function buildInsights(reviews, { asOf, propertyName = 'all properties', ...opts }) {
  const w = weekWindows(asOf);
  const thisWeek = reviews.filter((r) => inRange(r, w.thisWeek.from, w.thisWeek.to));
  const lastWeek = reviews.filter((r) => inRange(r, w.lastWeek.from, w.lastWeek.to));
  const insights = [];
  const cmp = weekComparison(reviews, asOf);

  if (!thisWeek.length) {
    insights.push({ tone: 'neutral', text: `No reviews have been published yet this week for ${propertyName}.` });
  } else if (cmp.avgChange != null && opts.includeAverage) {
    const dir = cmp.avgChange > 0 ? 'up' : cmp.avgChange < 0 ? 'down' : 'unchanged';
    insights.push({
      tone: cmp.avgChange < -0.2 ? 'bad' : cmp.avgChange > 0.2 ? 'good' : 'neutral',
      text: `Average rating this week is ${cmp.current.avg.toFixed(1)} (${cmp.current.n} review${cmp.current.n === 1 ? '' : 's'}), ${dir}${dir === 'unchanged' ? '' : ` ${Math.abs(cmp.avgChange).toFixed(1)}`} from ${cmp.previous.avg.toFixed(1)} last week (${cmp.previous.n}).${cmp.lowSample ? ' Few reviews, so treat the change with caution.' : ''}`,
    });
  }

  // Topic insight on the most recent window with enough negative reviews.
  const windows = [
    { list: thisWeek, label: 'this week', from: w.thisWeek.from },
    { list: [...thisWeek, ...lastWeek], label: 'over the last two weeks', from: w.lastWeek.from },
  ];
  const pick = windows.find((x) => x.list.filter((r) => r.sentiment === 'negative' && hasComments(r)).length >= 5) || windows[1];
  const range = { from: pick.from, to: asOf };
  const stats = topicStats(pick.list);
  const negN = stats[0]?.negativeWithText || 0;
  if (negN > 0) {
    // Urgent topics get their own line below, so leave them out here.
    const ranked = stats.filter((s) => s.negativeMentioning > 0 && !s.critical).sort((a, b) => b.negativeMentioning - a.negativeMentioning);
    for (const s of ranked.slice(0, 2)) {
      insights.push({
        tone: 'bad',
        topic: s.id,
        range,
        // With very few negative reviews a percentage overstates certainty, so give the count instead.
        text: negN >= 5
          ? `${pct(s.complaintShareOfNegative)} of negative reviews ${pick.label} mentioned ${s.label.toLowerCase()} issues (${s.negativeMentioning} of ${negN} negative reviews with comments).`
          : `${s.negativeMentioning} of the ${negN} negative review${negN === 1 ? '' : 's'} with comments ${pick.label} mentioned ${s.label.toLowerCase()} issues.`,
      });
    }
  }

  // Critical topics (pests, safety) always surface, even once.
  for (const t of TOPICS.filter((x) => x.critical)) {
    const hits = pick.list.filter((r) => r.topics?.complaints?.includes(t.id));
    if (hits.length) {
      insights.push({ tone: 'critical', topic: t.id, range, text: `${hits.length} review${hits.length === 1 ? '' : 's'} ${pick.label} mentioned ${t.mention || t.label.toLowerCase()}. Worth a follow-up.` });
    }
  }

  // What guests like most, for balance.
  const praised = stats.filter((s) => s.praise > 0).sort((a, b) => b.praise - a.praise)[0];
  const praiseBase = pick.list.filter((r) => r.positive).length;
  if (praised && praiseBase >= 3) {
    insights.push({ tone: 'good', topic: praised.id, range, text: `Most praised ${pick.label}: ${praised.label.toLowerCase()}, mentioned positively in ${praised.praise} of ${praiseBase} reviews with "liked" comments.` });
  }

  const ratingOnly = pick.list.filter((r) => !hasComments(r)).length;
  if (pick.list.length && ratingOnly / pick.list.length >= 0.3) {
    insights.push({ tone: 'neutral', text: `${pct(ratingOnly / pick.list.length)} of reviews ${pick.label} are rating-only, with no written comments, so topic figures are based on the remaining ${pick.list.length - ratingOnly}.` });
  }
  return insights;
}

/** Change in complaint counts versus the previous period of equal length. */
export function topicTrend(reviews, from, to) {
  const days = Math.round((Date.parse(to) - Date.parse(from)) / 86400000) + 1;
  const prevTo = addDays(from, -1);
  const prevFrom = addDays(from, -days);
  const cur = topicStats(reviews.filter((r) => inRange(r, from, to)));
  const prev = new Map(topicStats(reviews.filter((r) => inRange(r, prevFrom, prevTo))).map((s) => [s.id, s]));
  return {
    previous: { from: prevFrom, to: prevTo },
    rows: cur.map((s) => {
      const p = prev.get(s.id);
      return { ...s, previousComplaints: p.complaints, previousShare: p.complaintShareOfAll, shareChange: s.complaintShareOfAll != null && p.complaintShareOfAll != null ? s.complaintShareOfAll - p.complaintShareOfAll : null, description: TOPIC_BY_ID[s.id].description };
    }),
  };
}
