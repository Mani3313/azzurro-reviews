/**
 * BROWSER-ASSISTED COLLECTOR (manual fallback)
 *
 * When the automated scraper can't run (e.g. its network is blocked, or
 * Booking.com shows the headless browser a bot check), a person can collect
 * the same data from their own normal browser session:
 *
 *   1. Open a property page, e.g. https://www.booking.com/hotel/au/olympic-paddington.en-gb.html
 *   2. Open DevTools → Console, paste this whole file, press Enter.
 *   3. Run:  await azzurroCollect('olympic-paddington', 40)   // slug, max pages
 *   4. A file azzurro-<slug>.json downloads. Import it:
 *        npm run import -- ~/Downloads/azzurro-olympic-paddington.json
 *
 * It uses the same data-testid selectors as scraper/extract.js, hashes
 * reviewer names in the browser (names never leave the page), and the
 * importer runs the same validation/dedupe as the scraper.
 * The bundled sample data in data/raw/ was collected this way, because the
 * development environment's network could not reach Booking.com.
 */
/* eslint-disable no-undef */
window.azzurroCollect = async function azzurroCollect(slug, maxPages = 40) {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const byTid = (root, tid) => (root ? root.querySelector(`[data-testid="${tid}"]`) : null);
  const clean = (s) => (s == null ? null : s.replace(/\s+/g, ' ').trim() || null);
  const text = (el) => (el ? clean(el.textContent) : null);
  const spansText = (el, skip) => clean([...el.querySelectorAll('span')]
    .filter((s) => !s.querySelector('svg') && !s.closest('svg') && !(skip && skip(s)))
    .map((s) => s.textContent).join(' '));

  const scoreText = (el) => {
    if (!el) return null;
    for (const node of [el, ...el.querySelectorAll('*')]) {
      const own = clean([...node.childNodes].filter((n) => n.nodeType === 3).map((n) => n.textContent).join(''));
      if (own && /^\d{1,2}(?:[.,]\d)?$/.test(own)) return own;
    }
    return text(el);
  };

  const extract = () => [...document.querySelectorAll('[data-testid="review-card"]')].map((card) => {
    const avatar = byTid(card, 'review-avatar');
    const reply = byTid(card, 'review-partner-reply');
    const heading = reply && reply.querySelector('h3');
    const countryBits = avatar ? [...avatar.querySelectorAll('span')].map((s) => clean(s.textContent)).filter(Boolean) : [];
    const pos = byTid(card, 'review-positive-text');
    const neg = byTid(card, 'review-negative-text');
    return {
      reviewerName: text(avatar && avatar.querySelector('h4')),
      reviewerCountry: countryBits.length ? countryBits[countryBits.length - 1] : null,
      roomType: text(byTid(card, 'review-room-name')),
      nights: text(byTid(card, 'review-num-nights')),
      stayDate: text(byTid(card, 'review-stay-date')),
      travellerType: text(byTid(card, 'review-traveler-type')),
      reviewDate: text(byTid(card, 'review-date')),
      title: text(byTid(card, 'review-title')),
      score: scoreText(byTid(card, 'review-score')),
      positive: pos ? spansText(pos) || text(pos) : null,
      negative: neg ? spansText(neg) || text(neg) : null,
      hotelReply: reply ? spansText(reply, (s) => s.closest('button') || (heading && heading.contains(s))) : null,
    };
  });

  const signature = () => [...document.querySelectorAll('[data-testid="review-card"]')].map((c) => c.textContent.slice(0, 80)).join('|');
  const waitForChange = async (prev, ms = 12000) => {
    const t = Date.now();
    while (Date.now() - t < ms) {
      await sleep(300);
      const s = signature();
      if (s && s !== prev) return true;
    }
    return false;
  };
  const hash = async (s) => {
    if (!s) return null;
    const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s.trim().toLowerCase()));
    return [...new Uint8Array(buf)].map((x) => x.toString(16).padStart(2, '0')).join('').slice(0, 16);
  };

  // Open the review panel.
  if (!document.querySelector('[data-testid="review-card"]')) {
    const triggers = [...document.querySelectorAll('[data-testid="fr-read-all-reviews"], [data-testid="review-score-read-all"], [data-testid="Property-Header-Nav-Tab-Trigger-reviews"]')];
    for (const el of triggers) {
      (el.closest('button,a') || el).click();
      await sleep(1500);
      if (document.querySelector('[data-testid="review-card"]')) break;
    }
  }
  if (!document.querySelector('[data-testid="review-card"]')) throw new Error('Could not open the review list');

  // Newest first.
  const sorter = document.querySelector('[data-testid="review-sorter"] select');
  if (sorter && sorter.value !== 'NEWEST_FIRST') {
    const prev = signature();
    Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set.call(sorter, 'NEWEST_FIRST');
    sorter.dispatchEvent(new Event('change', { bubbles: true }));
    await waitForChange(prev);
  }

  const header = clean((document.querySelector('[data-testid="reviews-tab-score-header"]') || {}).textContent || '');
  const reviews = [];
  let page = 0;
  while (page < maxPages) {
    await sleep(1000 + Math.random() * 1000);
    document.querySelectorAll('[data-testid="review-pr-toggle"]').forEach((b) => /continue|read more/i.test(b.textContent) && b.click());
    await sleep(400);
    page++;
    for (const r of extract()) {
      r.reviewerKey = await hash(r.reviewerName);
      delete r.reviewerName;
      reviews.push(r);
    }
    const next = document.querySelector('button[aria-label="Next page"]');
    if (!next || next.disabled) break;
    const prev = signature();
    next.click();
    if (!(await waitForChange(prev))) break;
  }
  if (!reviews.length) throw new Error('No review cards found: the layout may have changed');

  const out = { property: slug, source: 'browser-assisted', sourceUrl: location.origin + location.pathname, collectedAt: new Date().toISOString(), header, pagesRead: page, reviews };
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([JSON.stringify(out, null, 1)], { type: 'application/json' }));
  a.download = `azzurro-${slug}.json`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  return { slug, pages: page, reviews: reviews.length };
};
