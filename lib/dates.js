/**
 * Date helpers. Booking.com shows review dates as calendar days ("Reviewed:
 * 23 October 2026") with no time, so every date in the system is a plain
 * 'YYYY-MM-DD' string. Strings compare correctly with < and >, sort
 * correctly, and avoid all timezone drift. Weeks run Monday to Sunday.
 */
import { HOTEL_TIMEZONE } from '../config/properties.js';

const MONTHS = {
  january: 1, february: 2, march: 3, april: 4, may: 5, june: 6,
  july: 7, august: 8, september: 9, october: 10, november: 11, december: 12,
};

const pad = (n) => String(n).padStart(2, '0');

/** Validates a calendar date and returns 'YYYY-MM-DD', or null if impossible. */
export function toIsoDate(year, month, day) {
  const d = new Date(Date.UTC(year, month - 1, day));
  if (d.getUTCFullYear() !== year || d.getUTCMonth() !== month - 1 || d.getUTCDate() !== day) return null;
  return `${year}-${pad(month)}-${pad(day)}`;
}

/** "Reviewed: 23 October 2026" -> "2026-10-23". */
export function parseReviewDate(raw) {
  if (!raw) return null;
  const text = raw.includes(':') ? raw.slice(raw.indexOf(':') + 1) : raw;
  const m = text.trim().match(/^(\d{1,2})\s+([A-Za-z]+)\s+(\d{4})$/);
  if (!m) return null;
  const month = MONTHS[m[2].toLowerCase()];
  return month ? toIsoDate(Number(m[3]), month, Number(m[1])) : null;
}

/** "September 2026" -> "2026-09". */
export function parseStayMonth(raw) {
  if (!raw) return null;
  const m = raw.trim().match(/^([A-Za-z]+)\s+(\d{4})$/);
  const month = m && MONTHS[m[1].toLowerCase()];
  return month ? `${m[2]}-${pad(month)}` : null;
}

function fromIso(iso) {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d));
}

function toIso(date) {
  return `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())}`;
}

export function addDays(iso, days) {
  const d = fromIso(iso);
  d.setUTCDate(d.getUTCDate() + days);
  return toIso(d);
}

/** Monday of the week containing `iso`. */
export function weekStart(iso) {
  const d = fromIso(iso);
  const dow = (d.getUTCDay() + 6) % 7; // Monday = 0
  return addDays(iso, -dow);
}

export function daysBetween(fromIsoDate, toIsoDate_) {
  return Math.round((fromIso(toIsoDate_) - fromIso(fromIsoDate)) / 86400000);
}

/** Today's calendar date in Sydney. */
export function todayInSydney(now = new Date()) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: HOTEL_TIMEZONE }).format(now);
}

/** Sydney calendar date for a timestamp (e.g. when a scrape ran). */
export function sydneyDateOf(timestamp) {
  return todayInSydney(new Date(timestamp));
}

const SHORT_MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** "2026-10-19" -> "19 Oct". */
export function formatDay(iso, withYear = false) {
  if (!iso) return '';
  const [y, m, d] = iso.split('-').map(Number);
  return `${d} ${SHORT_MONTHS[m - 1]}${withYear ? ` ${y}` : ''}`;
}

export function formatRange(from, to) {
  const sameYear = from.slice(0, 4) === to.slice(0, 4);
  return `${formatDay(from, !sameYear)} – ${formatDay(to, true)}`;
}

/** "2026-09" -> "Sep 2026". */
export function formatMonth(ym) {
  if (!ym) return '';
  const [y, m] = ym.split('-').map(Number);
  return `${SHORT_MONTHS[m - 1]} ${y}`;
}
