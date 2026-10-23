/** Small presentational pieces used across pages (server components). */
import { TOPIC_BY_ID } from '../lib/topics/taxonomy.js';
import { deltaClass } from '../lib/ui.js';

export function ScoreBadge({ score, sentiment }) {
  const label = sentiment === 'positive' ? 'positive' : sentiment === 'negative' ? 'negative' : 'neutral';
  return <span className={`score ${label}`} title={`Score ${score} out of 10 (${label})`}>{Number.isInteger(score) ? score : score.toFixed(1)}</span>;
}

/** Signed change. `lowerIsBetter` colours a decrease green (e.g. complaint share). */
export function Delta({ value, suffix = '', lowerIsBetter = false, digits = 1 }) {
  // Treat anything that rounds to zero at the shown precision as "no change".
  const dir = value == null || Math.abs(value) < 0.5 * 10 ** -digits ? 'flat' : deltaClass(value);
  const good = dir === 'flat' ? 'flat' : (dir === 'up') !== lowerIsBetter ? 'up' : 'down';
  const word = dir === 'up' ? 'up' : dir === 'down' ? 'down' : 'no change';
  const text = value == null ? '–' : dir === 'flat' ? 'no change' : `${value > 0 ? '+' : '−'}${Math.abs(value).toFixed(digits)}`;
  return (
    <span className={`delta ${good}`}>
      <span aria-hidden="true">{dir === 'up' ? '▲ ' : dir === 'down' ? '▼ ' : ''}</span>
      {text}{suffix}
      <span className="visually-hidden"> ({word})</span>
    </span>
  );
}

export function TopicChip({ id, kind, href, evidence }) {
  const t = TOPIC_BY_ID[id];
  if (!t) return null;
  const cls = kind === 'complaint' && t.critical ? 'critical' : kind;
  const title = `${kind === 'complaint' ? 'Complaint' : 'Praise'}: ${t.label}${evidence?.length ? ` (matched: ${evidence.join(', ')})` : ''}`;
  const content = <>{kind === 'complaint' ? '−' : '+'} {t.label}</>;
  return href ? <a className={`chip ${cls}`} href={href} title={title}>{content}</a> : <span className={`chip ${cls}`} title={title}>{content}</span>;
}

export function ToneIcon({ tone }) {
  const glyph = { bad: '!', critical: '!!', good: '+', neutral: 'i' }[tone] || 'i';
  return <span className="tone-icon" aria-hidden="true">{glyph}</span>;
}

/** Tiny multi-week trend line for a property card. Weeks with no reviews leave a gap. */
export function Sparkline({ values, color, width = 72, height = 24 }) {
  const pts = values
    .map((v, i) => (v == null ? null : { x: (i / (values.length - 1)) * width, y: height - (v / 10) * height }))
    .filter(Boolean);
  if (pts.length < 2) return <span className="faint small">Not enough data</span>;
  const points = pts.map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ');
  return (
    <svg className="sparkline" viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none" aria-hidden="true">
      <polyline points={points} fill="none" stroke={color} strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
    </svg>
  );
}

export function SetupNeeded({ error }) {
  return (
    <div className="panel empty" style={{ marginTop: 32 }}>
      <h2>The dashboard can't reach its database</h2>
      <p style={{ marginBottom: 12 }}>{error}</p>
      <p>Start MongoDB (<code>docker compose up -d</code>), load the sample reviews (<code>npm run seed</code>), then reload this page.</p>
    </div>
  );
}

export function NoData() {
  return (
    <div className="panel empty" style={{ marginTop: 32 }}>
      <h2>No reviews collected yet</h2>
      <p>Load the bundled sample with <code>npm run seed</code>, or collect live reviews with <code>npm run scrape</code>.</p>
    </div>
  );
}
