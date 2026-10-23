import { PROPERTIES, PROPERTY_BY_SLUG } from '../../config/properties.js';
import { TOPICS } from '../../lib/topics/taxonomy.js';
import { getDb, getAsOf, parseFilters, parseFeedFilters, getFeed, PERIODS } from '../../lib/queries.js';
import { formatDay, formatMonth, formatRange } from '../../lib/dates.js';
import { LANGUAGE_NAMES } from '../../lib/language.js';
import { withParams } from '../../lib/ui.js';
import FilterBar from '../../components/FilterBar';
import { ScoreBadge, TopicChip, SetupNeeded } from '../../components/bits';

export const dynamic = 'force-dynamic';

function FeedFilters({ feed, hidden }) {
  return (
    <form method="get" action="/reviews" className="panel panel-pad" style={{ display: 'flex', flexWrap: 'wrap', gap: '12px 16px', alignItems: 'flex-end', marginBottom: 16 }}>
      {Object.entries(hidden).map(([k, v]) => v && <input key={k} type="hidden" name={k} value={v} />)}
      <div className="field">
        <label htmlFor="q">Search the text</label>
        <input id="q" type="search" name="q" defaultValue={feed.q} placeholder="e.g. shower, Shella, refund" />
      </div>
      <div className="field">
        <label htmlFor="sentiment">Rating</label>
        <select id="sentiment" name="sentiment" defaultValue={feed.sentiment}>
          <option value="">All ratings</option>
          <option value="negative">Negative (1–5)</option>
          <option value="neutral">Neutral (6–7)</option>
          <option value="positive">Positive (8–10)</option>
        </select>
      </div>
      <div className="field">
        <label htmlFor="complaint">Complains about</label>
        <select id="complaint" name="complaint" defaultValue={feed.complaint}>
          <option value="">Any topic</option>
          {TOPICS.map((t) => <option key={t.id} value={t.id}>{t.label}</option>)}
        </select>
      </div>
      <div className="field">
        <label htmlFor="praise">Praises</label>
        <select id="praise" name="praise" defaultValue={feed.praise}>
          <option value="">Any topic</option>
          {TOPICS.map((t) => <option key={t.id} value={t.id}>{t.label}</option>)}
        </select>
      </div>
      <div className="field">
        <label htmlFor="text">Comments</label>
        <select id="text" name="text" defaultValue={feed.text}>
          <option value="">With or without</option>
          <option value="with">Written comments only</option>
          <option value="without">Rating only</option>
        </select>
      </div>
      <div className="field">
        <label htmlFor="replied">Hotel reply</label>
        <select id="replied" name="replied" defaultValue={feed.replied}>
          <option value="">Any</option>
          <option value="no">Not replied yet</option>
          <option value="yes">Replied</option>
        </select>
      </div>
      <div className="field">
        <label htmlFor="sort">Order</label>
        <select id="sort" name="sort" defaultValue={feed.sort}>
          <option value="newest">Newest first</option>
          <option value="oldest">Oldest first</option>
          <option value="lowest">Lowest score first</option>
          <option value="highest">Highest score first</option>
        </select>
      </div>
      <button className="btn" type="submit">Show reviews</button>
      <a className="btn ghost" href={withParams('/reviews', hidden, {})}>Clear</a>
    </form>
  );
}

function Review({ r, linkBase }) {
  const p = PROPERTY_BY_SLUG[r.property];
  const ev = r.topics?.evidence || {};
  const meta = [
    formatDay(r.reviewDate, true),
    p?.name,
    r.travellerType,
    r.roomType,
    r.nights ? `${r.nights} night${r.nights === 1 ? '' : 's'}${r.stayMonth ? ` in ${formatMonth(r.stayMonth)}` : ''}` : null,
    r.reviewerCountry ? `from ${r.reviewerCountry}` : null,
  ].filter(Boolean);
  return (
    <article className="panel review">
      <ScoreBadge score={r.score} sentiment={r.sentiment} />
      <div style={{ display: 'grid', gap: 4 }}>
        <div className="review-title">{r.title || 'Untitled review'}</div>
        <div className="review-meta">{meta.map((m, i) => <span key={i}>{m}</span>)}</div>
      </div>
      <div className="review-body">
        {r.positive && (
          <div className="said liked"><span className="said-icon" aria-label="Liked">+</span><p>{r.positive}</p></div>
        )}
        {r.negative && (
          <div className="said disliked"><span className="said-icon" aria-label="Disliked">−</span><p>{r.negative}</p></div>
        )}
        {!r.hasText && <p className="faint small">Rating only. The guest left no written comments.</p>}
        {(r.topics?.complaints?.length > 0 || r.topics?.praise?.length > 0 || (r.language && r.language !== 'en')) && (
          <div className="chips">
            {r.topics?.complaints?.map((t) => <TopicChip key={`c${t}`} id={t} kind="complaint" evidence={ev.complaints?.[t]} href={withParams('/reviews', linkBase, { complaint: t })} />)}
            {r.topics?.praise?.map((t) => <TopicChip key={`p${t}`} id={t} kind="praise" evidence={ev.praise?.[t]} href={withParams('/reviews', linkBase, { praise: t })} />)}
            {r.language && r.language !== 'en' && <span className="chip lang">{LANGUAGE_NAMES[r.language] || r.language}</span>}
          </div>
        )}
        {r.hotelReply ? (
          <details className="reply">
            <summary>Hotel replied</summary>
            <p style={{ marginTop: 6 }}>{r.hotelReply}</p>
          </details>
        ) : r.hasText && r.sentiment === 'negative' ? (
          <p className="small" style={{ color: 'var(--warn)' }}>No hotel reply yet.</p>
        ) : null}
      </div>
    </article>
  );
}

export default async function ReviewsPage({ searchParams }) {
  const sp = await searchParams;
  let db;
  try {
    db = await getDb();
  } catch (err) {
    return <SetupNeeded error={err.message} />;
  }
  const { asOf } = await getAsOf(db);
  const filters = parseFilters(sp, asOf);
  const feed = parseFeedFilters(sp);
  const result = await getFeed(db, filters, feed);

  const base = { property: filters.property, period: filters.period, from: filters.period === 'custom' ? filters.from : '', to: filters.period === 'custom' ? filters.to : '' };
  const current = { ...base, sentiment: feed.sentiment, complaint: feed.complaint, praise: feed.praise, text: feed.text, replied: feed.replied, q: feed.q, sort: feed.sort === 'newest' ? '' : feed.sort };
  const scope = filters.property === 'all' ? 'all properties' : PROPERTY_BY_SLUG[filters.property].name;

  return (
    <>
      <FilterBar properties={PROPERTIES} periods={PERIODS} filters={{ ...filters, asOf }} asOfLabel={<>Data as of <strong>{formatDay(asOf, true)}</strong></>} />
      <div className="section-head">
        <h1 style={{ fontSize: '1.5rem' }}>Reviews</h1>
        <p>{result.total.toLocaleString('en-AU')} review{result.total === 1 ? '' : 's'} for {scope}, {formatRange(filters.from, filters.to)}</p>
      </div>
      <FeedFilters feed={feed} hidden={base} />
      {result.items.length === 0 ? (
        <div className="panel empty">
          <h2>No reviews match these filters</h2>
          <p>Try a longer period or remove a filter. <a href={withParams('/reviews', base, {})}>Clear filters</a></p>
        </div>
      ) : (
        <div className="feed">
          {result.items.map((r) => <Review key={r._id} r={r} linkBase={base} />)}
        </div>
      )}
      {result.pages > 1 && (
        <nav className="pager" aria-label="Pages">
          {feed.page > 1 ? <a className="btn ghost" href={withParams('/reviews', current, { page: feed.page - 1 })}>Previous page</a> : <span />}
          <span className="muted small">Page {feed.page} of {result.pages}</span>
          {feed.page < result.pages ? <a className="btn ghost" href={withParams('/reviews', current, { page: feed.page + 1 })}>Next page</a> : <span />}
        </nav>
      )}
    </>
  );
}
