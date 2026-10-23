/** Presentation helpers shared by server and client components. */
import { PROPERTIES } from '../config/properties.js';

/**
 * Fixed colour per property (never by rank), so a property keeps its colour
 * when filters change. Order validated for colour-blind separation.
 */
export const PROPERTY_COLOR_VAR = Object.fromEntries(PROPERTIES.map((p, i) => [p.slug, `var(--series-${i + 1})`]));

export const fmtAvg = (x) => (x == null ? '–' : x.toFixed(1));
export const fmtPct = (x) => (x == null ? '–' : `${Math.round(x * 100)}%`);
export const fmtDelta = (x) => (x == null ? '–' : `${x > 0 ? '+' : x < 0 ? '−' : '±'}${Math.abs(x).toFixed(1)}`);
export const deltaClass = (x) => (x == null || Math.abs(x) < 0.05 ? 'flat' : x > 0 ? 'up' : 'down');

export function fmtDateTime(d) {
  if (!d) return '–';
  return new Intl.DateTimeFormat('en-AU', { timeZone: 'Australia/Sydney', day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit' }).format(new Date(d));
}

/** Builds a query string from the current params with some keys replaced. */
export function withParams(base, current, changes) {
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries({ ...current, ...changes })) {
    if (v !== undefined && v !== null && v !== '' && !(k === 'property' && v === 'all')) sp.set(k, v);
  }
  const s = sp.toString();
  return s ? `${base}?${s}` : base;
}
