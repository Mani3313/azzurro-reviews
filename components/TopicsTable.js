'use client';
import { useState } from 'react';
import { withParams, fmtPct } from '../lib/ui.js';
import { Delta } from './bits.js';

const SORTS = {
  complaints: (a, b) => b.complaints - a.complaints,
  change: (a, b) => Math.abs(b.shareChange ?? 0) - Math.abs(a.shareChange ?? 0),
  praise: (a, b) => b.praise - a.praise,
};
const SORT_LABELS = [
  ['complaints', 'Most complaints'],
  ['change', 'Biggest change'],
  ['praise', 'Most praise'],
];

/** "What guests talk about" table, sortable client-side so the server page stays static. */
export default function TopicsTable({ rows, maxComplaints, maxPraise, params }) {
  const [sort, setSort] = useState('complaints');
  const sorted = [...rows].sort(SORTS[sort]);
  const feedLink = (extra) => withParams('/reviews', params, extra);

  return (
    <>
      <div className="sort-row">
        <span className="small muted">Sort by</span>
        <div className="sort-group">
          {SORT_LABELS.map(([id, label]) => (
            <button key={id} type="button" className={`sort-btn${sort === id ? ' active' : ''}`} aria-pressed={sort === id} onClick={() => setSort(id)}>
              {label}
            </button>
          ))}
        </div>
      </div>
      <div className="panel table-wrap">
        <table>
          <thead>
            <tr>
              <th>Topic</th>
              <th className="bar-cell">Complaints</th>
              <th className="r">Share of complaints</th>
              <th className="r">vs previous period</th>
              <th className="r">Mentioned in negative reviews</th>
              <th className="bar-cell">Praise</th>
            </tr>
          </thead>
          <tbody>
            {sorted.map((t) => (
              <tr key={t.id}>
                <td>
                  <strong>{t.label}</strong>{t.critical && <span className="caution" title="Urgent topic: follow up on every mention">urgent</span>}
                  <div className="faint small">{t.description}</div>
                </td>
                <td className="bar-cell">
                  <a href={feedLink({ complaint: t.id })} className="num">{t.complaints} review{t.complaints === 1 ? '' : 's'}</a>
                  <div className="bar bad" aria-hidden="true"><span style={{ width: `${(t.complaints / maxComplaints) * 100}%` }} /></div>
                </td>
                <td className="r num">{fmtPct(t.complaintShareOfAll)}</td>
                <td className="r">{t.shareChange == null ? <span className="faint">–</span> : <Delta value={t.shareChange * 100} suffix=" pts" lowerIsBetter digits={0} />}
                  <div className="faint small num">was {fmtPct(t.previousShare)}</div></td>
                <td className="r num">{fmtPct(t.complaintShareOfNegative)}<div className="faint small">{t.negativeMentioning} of {t.negativeWithText}</div></td>
                <td className="bar-cell">
                  <a href={feedLink({ praise: t.id })} className="num">{t.praise} review{t.praise === 1 ? '' : 's'}</a>
                  <div className="bar good" aria-hidden="true"><span style={{ width: `${(t.praise / maxPraise) * 100}%` }} /></div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
