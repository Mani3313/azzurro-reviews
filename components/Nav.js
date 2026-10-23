'use client';
import Link from 'next/link';
import { usePathname, useSearchParams } from 'next/navigation';

const LINKS = [
  { href: '/', label: 'Overview' },
  { href: '/reviews', label: 'Reviews' },
  { href: '/data', label: 'Data health' },
  { href: '/how-it-works', label: 'How it works' },
];

/** Keeps the property/period selection when moving between pages. */
export default function Nav() {
  const path = usePathname();
  const sp = useSearchParams();
  const keep = new URLSearchParams();
  for (const k of ['property', 'period', 'from', 'to']) if (sp.get(k)) keep.set(k, sp.get(k));
  const qs = keep.toString();
  return (
    <nav className="nav" aria-label="Main">
      {LINKS.map((l) => (
        <Link key={l.href} href={qs && l.href !== '/how-it-works' ? `${l.href}?${qs}` : l.href} aria-current={path === l.href ? 'page' : undefined}>
          {l.label}
        </Link>
      ))}
    </nav>
  );
}
