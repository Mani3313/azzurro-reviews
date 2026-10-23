import { PROPERTIES, PROPERTY_BY_SLUG } from '../../config/properties.js';
import { getDb, getAsOf, getRuns, getPropertyMeta, getQualityStats } from '../../lib/queries.js';
import { formatDay } from '../../lib/dates.js';
import { LANGUAGE_NAMES } from '../../lib/language.js';
import { fmtPct, fmtDateTime } from '../../lib/ui.js';
import { SetupNeeded } from '../../components/bits';

export const dynamic = 'force-dynamic';

const STATUS_TEXT = { success: 'OK', partial: 'Partly OK', failed: 'Failed', blocked: 'Blocked' };

export default async function DataHealth() {
  let db;
  try {
    db = await getDb();
  } catch (err) {
    return <SetupNeeded error={err.message} />;
  }
  const [{ asOf, lastCollectedAt, stale }, runs, meta, q] = await Promise.all([getAsOf(db), getRuns(db), getPropertyMeta(db), getQualityStats(db)]);
  const latestRun = Object.fromEntries(PROPERTIES.map((p) => [p.slug, runs.find((r) => r.property === p.slug)]));
  const t = q.totals;

  return (
    <>
      <div className="section" style={{ marginTop: 28 }}>
        <h1 style={{ fontSize: '1.5rem', marginBottom: 6 }}>Data health</h1>
        <p className="muted" style={{ maxWidth: '70ch' }}>
          Check this page before trusting a number. It shows when each property was last collected, whether it worked, and how complete the data is.
        </p>
        {stale && (
          <p className="panel panel-pad" style={{ marginTop: 16, background: 'var(--warn-wash)', borderColor: 'var(--warn)' }}>
            <strong>The data is out of date.</strong> The last successful collection was {fmtDateTime(lastCollectedAt)}. Run <code className="code">npm run scrape</code> (or ask whoever runs it) to refresh.
          </p>
        )}
      </div>

      <section className="section" aria-labelledby="coll-h">
        <div className="section-head"><h2 id="coll-h">Collection status</h2><p>Data as of {formatDay(asOf, true)}</p></div>
        <div className="panel table-wrap">
          <table>
            <thead>
              <tr>
                <th>Property</th>
                <th>Last run</th>
                <th>Result</th>
                <th className="r">New reviews</th>
                <th className="r">Stored</th>
                <th className="r">Booking.com total</th>
                <th className="r">Coverage</th>
                <th>Reviews stored from</th>
                <th>Notes</th>
              </tr>
            </thead>
            <tbody>
              {PROPERTIES.map((p) => {
                const run = latestRun[p.slug];
                const m = meta[p.slug] || {};
                const stored = q.byProperty[p.slug];
                return (
                  <tr key={p.slug}>
                    <td><strong>{p.name}</strong><div className="faint small"><a href={p.url} target="_blank" rel="noreferrer">Booking.com page</a></div></td>
                    <td className="small">{run ? fmtDateTime(run.finishedAt) : '–'}<div className="faint">{run ? `${run.mode}${run.source === 'browser-assisted' ? ' (browser-assisted)' : ''}` : ''}</div></td>
                    <td>{run ? <span className={`status ${run.status}`}>{STATUS_TEXT[run.status] || run.status}</span> : <span className="faint">never run</span>}</td>
                    <td className="r num">{run?.newReviews ?? '–'}</td>
                    <td className="r num">{stored?.n?.toLocaleString('en-AU') ?? 0}</td>
                    <td className="r num">{m.bookingReviewCount?.toLocaleString('en-AU') ?? '–'}</td>
                    <td className="r num">{stored && m.bookingReviewCount ? fmtPct(Math.min(1, stored.n / m.bookingReviewCount)) : '–'}</td>
                    <td className="small">{stored ? `${formatDay(stored.earliest, true)} to ${formatDay(stored.latest, true)}` : '–'}</td>
                    <td className="small">
                      {run?.error && <div style={{ color: 'var(--bad)' }}>{run.error.message}</div>}
                      {run?.stoppedBecause && <div className="faint">Stopped: {run.stoppedBecause}</div>}
                      {run?.warnings?.length > 0 && <div className="faint">{run.warnings.length} warning{run.warnings.length === 1 ? '' : 's'}: {run.warnings.slice(0, 2).join('; ')}</div>}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <p className="faint small" style={{ marginTop: 8 }}>
          Coverage is stored reviews as a share of Booking.com&rsquo;s all-time total. Older reviews are only needed for long-term trends; run <code className="code">npm run scrape:full</code> to backfill them.
          Weekly figures only need the recent pages, which every run reads.
        </p>
      </section>

      <section className="section grid-2" aria-label="Data quality">
        <div className="panel panel-pad">
          <h2 style={{ marginBottom: 12 }}>Data quality</h2>
          <table>
            <tbody>
              <tr><td>Reviews stored</td><td className="r num">{(t.n || 0).toLocaleString('en-AU')}</td></tr>
              <tr><td>With written comments</td><td className="r num">{fmtPct(t.n ? t.withText / t.n : null)}</td></tr>
              <tr><td>Rating only (no text, so no topics)</td><td className="r num">{fmtPct(t.n ? 1 - t.withText / t.n : null)}</td></tr>
              <tr><td>&ldquo;Disliked&rdquo; answers that just say &ldquo;nothing&rdquo; (not counted as complaints)</td><td className="r num">{t.nothingToDislike ?? 0}</td></tr>
              <tr><td>Reviews with text but no topic found</td><td className="r num">{t.untagged ?? 0}</td></tr>
              <tr><td>Possible edited duplicates (flagged, still counted)</td><td className="r num">{t.possibleDuplicates ?? 0}</td></tr>
              <tr><td>Hotel replies stored in shortened form</td><td className="r num">{t.truncatedReplies ?? 0}</td></tr>
            </tbody>
          </table>
          <p className="faint small" style={{ marginTop: 10 }}>
            Tagged by: {q.methods.map((m) => `${m._id.method === 'llm' ? 'AI model' : 'keyword rules'} ${m._id.version} (${m.n})`).join(', ') || '–'}
          </p>
        </div>
        <div className="panel panel-pad">
          <h2 style={{ marginBottom: 12 }}>Languages (reviews with comments)</h2>
          <table>
            <tbody>
              {q.langs.slice(0, 10).map((l) => (
                <tr key={l._id || 'none'}><td>{LANGUAGE_NAMES[l._id] || l._id || 'Unknown'}</td><td className="r num">{l.n}</td></tr>
              ))}
            </tbody>
          </table>
          <p className="faint small" style={{ marginTop: 10 }}>The keyword rules cover English well and about 15 other languages partly. Languages without word lists (for example Czech) get no topics.</p>
        </div>
      </section>

      <section className="section" aria-labelledby="runs-h">
        <div className="section-head"><h2 id="runs-h">Recent collection runs</h2></div>
        <div className="panel table-wrap">
          <table>
            <thead><tr><th>Finished</th><th>Property</th><th>Type</th><th>Result</th><th className="r">Pages</th><th className="r">Cards read</th><th className="r">New</th><th className="r">Rejected</th><th className="r">Took</th></tr></thead>
            <tbody>
              {runs.map((r) => (
                <tr key={r._id}>
                  <td className="small">{fmtDateTime(r.finishedAt)}</td>
                  <td>{PROPERTY_BY_SLUG[r.property]?.name || r.property}</td>
                  <td className="small">{r.mode}{r.source === 'browser-assisted' ? ' (browser-assisted)' : ''}</td>
                  <td><span className={`status ${r.status}`}>{STATUS_TEXT[r.status] || r.status}</span></td>
                  <td className="r num">{r.pagesRead ?? '–'}</td>
                  <td className="r num">{r.cardsSeen}</td>
                  <td className="r num">{r.newReviews}</td>
                  <td className="r num">{r.rejected}</td>
                  <td className="r num small">{r.durationMs != null ? `${Math.round(r.durationMs / 1000)}s` : '–'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </>
  );
}
