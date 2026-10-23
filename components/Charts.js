'use client';
import { useState } from 'react';
import {
  ResponsiveContainer, LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, BarChart, Bar,
} from 'recharts';

const axis = { stroke: 'var(--line-strong)', tick: { fill: 'var(--ink-3)', fontSize: 12 }, tickLine: false };

function RatingTooltip({ active, payload, label, series }) {
  if (!active || !payload?.length) return null;
  const row = payload[0].payload;
  return (
    <div className="tooltip">
      <div style={{ fontWeight: 700, marginBottom: 4 }}>Week of {label}{row.partial ? ' (so far)' : ''}</div>
      {series.map((s) => (
        <div className="tooltip-row" key={s.key}>
          <span><span className="swatch" style={{ display: 'inline-block', background: s.color, marginRight: 6 }} />{s.name}</span>
          <span className="num"><strong>{row[s.key] == null ? '–' : row[s.key].toFixed(1)}</strong> <span className="faint">({row[s.nKey]} reviews)</span></span>
        </div>
      ))}
    </div>
  );
}

/**
 * Weekly average rating, one line per property. Weeks with no reviews are
 * gaps, not zeros. Y axis is fixed at 0–10, so small wobbles don't look like crises.
 * Clicking a property in the legend isolates its line; clicking it again (or
 * "All properties") brings the rest back.
 */
export function RatingTrend({ data, series }) {
  const [focus, setFocus] = useState(null);
  const dimmed = (key) => focus != null && key !== focus;
  return (
    <>
      <div className="chart-box" role="img" aria-label="Line chart of weekly average rating by property">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={data} margin={{ top: 8, right: 12, bottom: 0, left: -18 }}>
            <CartesianGrid stroke="var(--line)" vertical={false} />
            <XAxis dataKey="label" {...axis} interval="preserveStartEnd" minTickGap={24} />
            <YAxis domain={[0, 10]} ticks={[0, 2, 4, 6, 8, 10]} {...axis} axisLine={false} />
            <Tooltip content={<RatingTooltip series={series} />} cursor={{ stroke: 'var(--line-strong)' }} />
            {[...series].sort((a, b) => (a.key === focus ? 1 : 0) - (b.key === focus ? 1 : 0)).map((s) => (
              <Line key={s.key} type="linear" dataKey={s.key} name={s.name} stroke={s.color} strokeWidth={focus === s.key ? 3 : 2}
                strokeOpacity={dimmed(s.key) ? 0.25 : 1}
                dot={dimmed(s.key) ? false : { r: 3, strokeWidth: 0, fill: s.color }}
                activeDot={dimmed(s.key) ? false : { r: 5, stroke: 'var(--surface)', strokeWidth: 2 }} connectNulls={false} isAnimationActive={false} />
            ))}
          </LineChart>
        </ResponsiveContainer>
      </div>
      {series.length > 1 && (
        <div className="legend legend-interactive">
          <button type="button" className={`legend-btn${focus == null ? ' active' : ''}`} aria-pressed={focus == null} onClick={() => setFocus(null)}>
            All properties
          </button>
          {series.map((s) => (
            <button key={s.key} type="button" className={`legend-btn${focus === s.key ? ' active' : ''}`} aria-pressed={focus === s.key}
              onClick={() => setFocus(focus === s.key ? null : s.key)}>
              <span className="swatch" style={{ background: s.color }} />{s.name}
            </button>
          ))}
        </div>
      )}
    </>
  );
}

function SentimentTooltip({ active, payload, label }) {
  if (!active || !payload?.length) return null;
  const r = payload[0].payload;
  return (
    <div className="tooltip">
      <div style={{ fontWeight: 700, marginBottom: 4 }}>Week of {label}{r.partial ? ' (so far)' : ''}</div>
      <div className="tooltip-row"><span>Positive (8–10)</span><strong className="num">{r.positive}</strong></div>
      <div className="tooltip-row"><span>Neutral (6–7)</span><strong className="num">{r.neutral}</strong></div>
      <div className="tooltip-row"><span>Negative (1–5)</span><strong className="num">{r.negative}</strong></div>
      <div className="tooltip-row faint"><span>Negative share</span><span className="num">{r.n ? Math.round((r.negative / r.n) * 100) : 0}%</span></div>
    </div>
  );
}

/** Weekly review counts split by sentiment (stacked). */
export function SentimentTrend({ data }) {
  return (
    <>
      <div className="chart-box" role="img" aria-label="Stacked bar chart of positive, neutral and negative reviews per week">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={data} margin={{ top: 8, right: 12, bottom: 0, left: -18 }} barCategoryGap="18%">
            <CartesianGrid stroke="var(--line)" vertical={false} />
            <XAxis dataKey="label" {...axis} interval="preserveStartEnd" minTickGap={24} />
            <YAxis allowDecimals={false} {...axis} axisLine={false} />
            <Tooltip content={<SentimentTooltip />} cursor={{ fill: 'var(--surface-2)' }} />
            <Bar dataKey="negative" stackId="s" fill="var(--neg)" stroke="var(--surface)" strokeWidth={1} isAnimationActive={false} />
            <Bar dataKey="neutral" stackId="s" fill="var(--neu)" stroke="var(--surface)" strokeWidth={1} isAnimationActive={false} />
            <Bar dataKey="positive" stackId="s" fill="var(--pos)" stroke="var(--surface)" strokeWidth={1} radius={[4, 4, 0, 0]} isAnimationActive={false} />
          </BarChart>
        </ResponsiveContainer>
      </div>
      <div className="legend">
        <span><span className="swatch" style={{ background: 'var(--pos)' }} />Positive (8–10)</span>
        <span><span className="swatch" style={{ background: 'var(--neu)' }} />Neutral (6–7)</span>
        <span><span className="swatch" style={{ background: 'var(--neg)' }} />Negative (1–5)</span>
      </div>
    </>
  );
}
