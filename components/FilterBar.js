'use client';
import { useRouter, usePathname, useSearchParams } from 'next/navigation';
import { useState } from 'react';

/**
 * Property + period filters. Changes apply immediately (no "Apply" button to
 * forget); a plain GET form underneath keeps it working without JavaScript.
 */
export default function FilterBar({ properties, periods, filters, asOfLabel, extra = null, showPeriod = true }) {
  const router = useRouter();
  const pathname = usePathname();
  const sp = useSearchParams();
  const [period, setPeriod] = useState(filters.period);

  const apply = (changes) => {
    const next = new URLSearchParams(sp.toString());
    for (const [k, v] of Object.entries(changes)) {
      if (v === '' || v == null || (k === 'property' && v === 'all')) next.delete(k);
      else next.set(k, v);
    }
    next.delete('page');
    if (changes.period && changes.period !== 'custom') {
      next.delete('from');
      next.delete('to');
    }
    router.push(`${pathname}${next.toString() ? `?${next}` : ''}`, { scroll: false });
  };

  return (
    <div className="filters">
      <form method="get" action={pathname} onSubmit={(e) => {
        e.preventDefault();
        const fd = new FormData(e.currentTarget);
        apply(Object.fromEntries(fd.entries()));
      }}>
        <div className="field">
          <label htmlFor="f-property">Property</label>
          <select id="f-property" name="property" defaultValue={filters.property} onChange={(e) => apply({ property: e.target.value })}>
            <option value="all">All four properties</option>
            {properties.map((p) => <option key={p.slug} value={p.slug}>{p.name}</option>)}
          </select>
        </div>
        {showPeriod && (
          <div className="field">
            <label htmlFor="f-period">Period</label>
            <select id="f-period" name="period" value={period} onChange={(e) => {
              setPeriod(e.target.value);
              if (e.target.value !== 'custom') apply({ period: e.target.value });
            }}>
              {periods.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
            </select>
          </div>
        )}
        {showPeriod && period === 'custom' && (
          <>
            <div className="field">
              <label htmlFor="f-from">From</label>
              <input id="f-from" type="date" name="from" defaultValue={filters.from} max={filters.asOf} />
            </div>
            <div className="field">
              <label htmlFor="f-to">To</label>
              <input id="f-to" type="date" name="to" defaultValue={filters.to} max={filters.asOf} />
            </div>
            <button className="btn" type="submit">Show dates</button>
          </>
        )}
        {extra}
        <noscript><button className="btn" type="submit">Apply</button></noscript>
        <div className="asof">{asOfLabel}</div>
      </form>
    </div>
  );
}
