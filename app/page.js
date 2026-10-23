import { PROPERTIES } from '../config/properties.js';
import { getDb, getAsOf, parseFilters, getAnalyticsReviews, getPropertyMeta, PERIODS } from '../lib/queries.js';
import { weekComparison, weeklySeries, propertyBreakdown, buildInsights, topicTrend, inRange, LOW_SAMPLE } from '../lib/analytics.js';
import { formatRange, formatDay } from '../lib/dates.js';
import { PROPERTY_COLOR_VAR, fmtAvg, fmtPct, fmtDateTime, withParams } from '../lib/ui.js';
import FilterBar from '../components/FilterBar';
import { RatingTrend, SentimentTrend } from '../components/Charts';
import { Delta, ToneIcon, Sparkline, SetupNeeded, NoData } from '../components/bits';
import TopicsTable from '../components/TopicsTable';

const ATTENTION_GROUPS = [
  { tone: 'critical', title: 'Follow up now' },
  { tone: 'bad', title: 'Most common complaints' },
  { tone: 'good', title: 'Most praised' },
];

export const dynamic = 'force-dynamic';

export default async function Overview({ searchParams }) {
  const sp = await searchParams;
  let db;
  try {
    db = await getDb();
  } catch (err) {
    return <SetupNeeded error={err.message} />;
  }
  const { asOf, lastCollectedAt, stale } = await getAsOf(db);
  const filters = parseFilters(sp, asOf);
  const [reviews, meta] = await Promise.all([getAnalyticsReviews(db, { ...filters, asOf }), getPropertyMeta(db)]);
  if (!reviews.length && !Object.keys(meta).length) return <NoData />;

  const scopeName = filters.property === 'all' ? 'all four properties' : filters.properties[0].name;
  const cmp = weekComparison(reviews, asOf);
  const periodReviews = reviews.filter((r) => inRange(r, filters.from, filters.to));
  const series = weeklySeries(periodReviews, filters.from, filters.to, filters.properties.map((p) => p.slug));
  const rows = propertyBreakdown(reviews, { asOf, from: filters.from, to: filters.to, properties: filters.properties, propertyMeta: meta });
  const insights = buildInsights(reviews, { asOf, propertyName: scopeName });
  const topics = topicTrend(reviews, filters.from, filters.to);
  const params = { property: filters.property, period: filters.period, from: filters.period === 'custom' ? filters.from : '', to: filters.period === 'custom' ? filters.to : '' };
  const feedLink = (extra) => withParams('/reviews', params, extra);

  const lineSeries = filters.properties.map((p) => ({ key: `avg_${p.slug}`, nKey: `n_${p.slug}`, name: p.name, color: PROPERTY_COLOR_VAR[p.slug] }));
  const maxComplaints = Math.max(1, ...topics.rows.map((t) => t.complaints));
  const maxPraise = Math.max(1, ...topics.rows.map((t) => t.praise));
  const periodLabel = formatRange(filters.from, filters.to);

  return (
    <>
      <FilterBar
        properties={PROPERTIES}
        periods={PERIODS}
        filters={{ ...filters, asOf }}
        asOfLabel={<>Data as of <strong>{formatDay(asOf, true)}</strong><br />{lastCollectedAt ? `Last collected ${fmtDateTime(lastCollectedAt)}` : 'Never collected'}{stale ? ' · out of date' : ''}</>}
      />

      <section className="hero" aria-labelledby="hero-line">
        <p className="hero-kicker">{cmp.windows.thisWeek.label} · {scopeName}</p>
        <h1 id="hero-line" className="hero-line">
          {cmp.current.n === 0 ? (
            <>No new reviews yet this week. Last week averaged <span className="big">{fmtAvg(cmp.previous.avg)}</span> from {cmp.previous.n} reviews.</>
          ) : (
            <>
              Guests rated us <span className="big">{fmtAvg(cmp.current.avg)}</span> out of 10 this week
              {cmp.avgChange != null && (
                <>, {cmp.avgChange === 0 ? 'the same as' : <span className={cmp.avgChange > 0 ? 'up' : 'down'}>{cmp.avgChange > 0 ? 'up' : 'down'} {Math.abs(cmp.avgChange).toFixed(1)}</span>}{cmp.avgChange === 0 ? '' : ' on'} last week&rsquo;s {fmtAvg(cmp.previous.avg)}</>
              )}.
            </>
          )}
        </h1>
        <p className="hero-note">
          {cmp.current.n} review{cmp.current.n === 1 ? '' : 's'} so far this week ({cmp.current.negative} negative), {cmp.previous.n} last week ({cmp.previous.negative} negative).
          {cmp.lowSample && ` Fewer than ${LOW_SAMPLE} reviews in one of the weeks, so a single review can swing the average.`}
        </p>
      </section>

      <section className="section" aria-labelledby="attention-h">
        <div className="section-head">
          <h2 id="attention-h">What needs attention</h2>
          <p>Based on this week, or the last two weeks when this week is quiet.</p>
        </div>
        <div className="attention-grid">
          {ATTENTION_GROUPS.map(({ tone, title }) => {
            const items = insights.filter((ins) => ins.tone === tone);
            if (!items.length) return null;
            return (
              <div key={tone} className={`panel panel-pad attention-card tone-${tone}`}>
                <h3><ToneIcon tone={tone} />{title}</h3>
                <ul className="attention">
                  {items.map((ins, i) => (
                    <li key={i} className={`tone-${ins.tone}`}>
                      <span>{ins.text}</span>
                      {ins.topic ? (
                        <a className="more" href={feedLink({ [ins.tone === 'good' ? 'praise' : 'complaint']: ins.topic, period: 'custom', from: ins.range.from, to: ins.range.to })}>Read these reviews</a>
                      ) : <span />}
                    </li>
                  ))}
                </ul>
              </div>
            );
          })}
        </div>
        {insights.filter((ins) => ins.tone === 'neutral').map((ins, i) => (
          <p key={i} className="faint small" style={{ marginTop: 12 }}>{ins.text}</p>
        ))}
      </section>

      <section className="section" aria-labelledby="props-h">
        <div className="section-head">
          <h2 id="props-h">Property by property</h2>
          <p>Week columns compare {formatRange(cmp.windows.thisWeek.from, cmp.windows.thisWeek.to)} with the week before. Period columns cover {periodLabel}.</p>
        </div>
        <div className="panel table-wrap">
          <table>
            <thead>
              <tr>
                <th>Property</th>
                <th className="r">This week</th>
                <th className="r">Last week</th>
                <th className="r">Change</th>
                <th className="r">Period average</th>
                <th className="r">Negative reviews</th>
                <th>Top complaint in period</th>
                <th className="r">Booking.com score</th>
                <th>{periodLabel} trend</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.slug}>
                  <td>
                    <span className="prop-name"><span className="swatch" style={{ background: PROPERTY_COLOR_VAR[r.slug] }} />
                      <a href={withParams('/', params, { property: r.slug })}>{r.name}</a>
                    </span>
                  </td>
                  <td className="r num"><strong>{fmtAvg(r.thisWeek.avg)}</strong> <span className="faint">({r.thisWeek.n})</span>{r.thisWeek.n > 0 && r.thisWeek.n < LOW_SAMPLE && <span className="caution" title={`Fewer than ${LOW_SAMPLE} reviews`}>few</span>}</td>
                  <td className="r num">{fmtAvg(r.lastWeek.avg)} <span className="faint">({r.lastWeek.n})</span></td>
                  <td className="r"><Delta value={r.change} /></td>
                  <td className="r num">{fmtAvg(r.period.avg)} <span className="faint">({r.period.n})</span></td>
                  <td className="r num">{fmtPct(r.period.negativeShare)}</td>
                  <td>{r.topComplaint ? <a href={feedLink({ property: r.slug, complaint: r.topComplaint.id })}>{r.topComplaint.label}</a> : <span className="faint">–</span>}
                    {r.topComplaint && <div className="faint small">{r.topComplaint.count} reviews</div>}</td>
                  <td className="r num">{r.bookingScore ?? '–'}{r.bookingReviewCount ? <div className="faint small">{r.bookingReviewCount.toLocaleString('en-AU')} reviews, all time</div> : null}</td>
                  <td><Sparkline values={series.map((w) => w[`avg_${r.slug}`])} color={PROPERTY_COLOR_VAR[r.slug]} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="section grid-2" aria-label="Trends">
        <div className="panel panel-pad">
          <h2 className="chart-title">Average rating per week</h2>
          <p className="chart-sub">{periodLabel}. Gaps mean no reviews that week. Hover for review counts.</p>
          <RatingTrend data={series} series={lineSeries} />
          <details className="table-view">
            <summary>Show as table</summary>
            <div className="table-wrap"><table>
              <thead><tr><th>Week of</th>{lineSeries.map((s) => <th key={s.key} className="r">{s.name}</th>)}</tr></thead>
              <tbody>{series.map((w) => <tr key={w.week}><td>{w.label}</td>{lineSeries.map((s) => <td key={s.key} className="r num">{fmtAvg(w[s.key])} <span className="faint">({w[s.nKey]})</span></td>)}</tr>)}</tbody>
            </table></div>
          </details>
        </div>
        <div className="panel panel-pad">
          <h2 className="chart-title">Positive and negative reviews per week</h2>
          <p className="chart-sub">{periodLabel}. Positive is 8 to 10, negative is 1 to 5.</p>
          <SentimentTrend data={series} />
          <details className="table-view">
            <summary>Show as table</summary>
            <div className="table-wrap"><table>
              <thead><tr><th>Week of</th><th className="r">Positive</th><th className="r">Neutral</th><th className="r">Negative</th><th className="r">Negative share</th></tr></thead>
              <tbody>{series.map((w) => <tr key={w.week}><td>{w.label}</td><td className="r num">{w.positive}</td><td className="r num">{w.neutral}</td><td className="r num">{w.negative}</td><td className="r num">{fmtPct(w.n ? w.negative / w.n : null)}</td></tr>)}</tbody>
            </table></div>
          </details>
        </div>
      </section>

      <section className="section" aria-labelledby="topics-h">
        <div className="section-head">
          <h2 id="topics-h">What guests talk about</h2>
          <p>{periodLabel}, compared with {formatRange(topics.previous.from, topics.previous.to)}. Only reviews with written comments count.</p>
        </div>
        <TopicsTable rows={topics.rows} maxComplaints={maxComplaints} maxPraise={maxPraise} params={params} />
        <p className="faint small" style={{ marginTop: 8 }}>
          Topics are tagged automatically from guests&rsquo; words, so treat them as a guide and read the reviews behind any number before acting on it.
          In &ldquo;vs previous period&rdquo;, green means the topic&rsquo;s share of complaints went down. <a href="/how-it-works#topics">How topics are tagged</a>
        </p>
      </section>
    </>
  );
}
