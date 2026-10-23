/**
 * DOM extractor for Booking.com review cards.
 *
 * This function runs INSIDE the browser page (Playwright serialises it with
 * page.evaluate), so it must be completely self-contained: no imports, no
 * closures over module scope.
 *
 * It only reads what is rendered for any anonymous visitor. It returns raw
 * strings; parsing/validation happens in normalize.js (Node side) so the
 * parsing rules can be unit-tested without a browser.
 *
 * Selector strategy: Booking.com's CSS class names are hashed and change on
 * every deploy, but its `data-testid` attributes are stable test hooks. We key
 * everything off data-testid and only fall back to structural selectors where
 * no test id exists (reviewer name / country).
 */
export function extractReviewCards() {
  const byTid = (root, tid) => (root ? root.querySelector(`[data-testid="${tid}"]`) : null);
  const clean = (s) => (s == null ? null : s.replace(/\s+/g, ' ').trim() || null);
  const text = (el) => (el ? clean(el.textContent) : null);

  // Liked / disliked blocks contain an icon plus a span holding the text.
  const commentText = (el) => {
    if (!el) return null;
    const spans = [...el.querySelectorAll('span')].filter((s) => !s.querySelector('svg') && !s.closest('svg'));
    const fromSpans = clean(spans.map((s) => s.textContent).join(' '));
    return fromSpans || text(el);
  };

  // The score block renders "Scored 8.0" and "8.0" in separate elements;
  // concatenated textContent can become "Scored 8.08.0", so prefer the
  // element whose own text is just the number.
  const scoreText = (el) => {
    if (!el) return null;
    for (const node of [el, ...el.querySelectorAll('*')]) {
      const own = clean([...node.childNodes].filter((n) => n.nodeType === 3).map((n) => n.textContent).join(''));
      if (own && /^\d{1,2}(?:[.,]\d)?$/.test(own)) return own;
    }
    return text(el);
  };

  const cards = [...document.querySelectorAll('[data-testid="review-card"]')];
  return cards.map((card) => {
    const avatar = byTid(card, 'review-avatar');
    const reply = byTid(card, 'review-partner-reply');
    let replyText = null;
    if (reply) {
      const heading = reply.querySelector('h3');
      const spans = [...reply.querySelectorAll('span')].filter(
        (s) => !s.querySelector('svg') && !s.closest('button') && !(heading && heading.contains(s))
      );
      replyText = clean(spans.map((s) => s.textContent).join(' '));
    }
    const avatarSpans = avatar ? [...avatar.querySelectorAll('span')].map((s) => clean(s.textContent)).filter(Boolean) : [];

    return {
      reviewerName: text(avatar && avatar.querySelector('h4')),
      reviewerCountry: avatarSpans.length ? avatarSpans[avatarSpans.length - 1] : null,
      roomType: text(byTid(card, 'review-room-name')),
      nights: text(byTid(card, 'review-num-nights')),
      stayDate: text(byTid(card, 'review-stay-date')),
      travellerType: text(byTid(card, 'review-traveler-type')),
      reviewDate: text(byTid(card, 'review-date')),
      title: text(byTid(card, 'review-title')),
      score: scoreText(byTid(card, 'review-score')),
      positive: commentText(byTid(card, 'review-positive-text')),
      negative: commentText(byTid(card, 'review-negative-text')),
      hotelReply: replyText,
    };
  });
}

/** Reads the overall score header ("Scored 6.8 ... 85 reviews") for health checks. */
export function extractHeader() {
  const el = document.querySelector('[data-testid="reviews-tab-score-header"]') ||
    document.querySelector('[data-testid="review-score-component"]');
  return el ? el.textContent.replace(/\s+/g, ' ').trim() : null;
}
