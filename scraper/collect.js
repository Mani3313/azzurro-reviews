/**
 * Collects reviews for one property with a real (headless) Chromium.
 *
 * Why a browser and not plain HTTP requests: the review list is rendered
 * client-side from Booking.com's internal GraphQL API, behind AWS WAF bot
 * protection. Calling that API directly would mean reverse-engineering and
 * replaying private tokens, which is brittle and the kind of evasion we don't
 * want to build. A browser simply loads the public page the way a guest does.
 *
 * Flow: open listing -> decline cookies -> open "Read all reviews" ->
 * sort "Newest first" -> read 10 cards -> "Next page" -> ...
 * In incremental mode it stops after `stopAfterKnownPages` consecutive pages
 * containing nothing new (2 by default, which absorbs page shifts caused by
 * reviews published mid-run).
 */
import fs from 'node:fs';
import path from 'node:path';
import { extractReviewCards, extractHeader } from './extract.js';
import { listingUrl } from '../config/properties.js';

export class CollectionError extends Error {
  /** @param {'BLOCKED'|'LAYOUT_CHANGED'|'NAVIGATION'|'NO_REVIEWS'} code */
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const jitter = (min, max) => min + Math.random() * (max - min);

/** Retries an async step with exponential backoff (1s, 2s, 4s...). */
export async function withRetry(fn, { attempts = 3, baseMs = 1000, label = 'step', log = () => {} } = {}) {
  let lastErr;
  for (let i = 1; i <= attempts; i++) {
    try {
      return await fn(i);
    } catch (err) {
      lastErr = err;
      if (err instanceof CollectionError && err.code === 'BLOCKED') throw err; // retrying won't help
      if (i < attempts) {
        const wait = baseMs * 2 ** (i - 1);
        log(`  ${label} failed (attempt ${i}/${attempts}): ${err.message.split('\n')[0]}; retrying in ${wait / 1000}s`);
        await sleep(wait);
      }
    }
  }
  throw lastErr;
}

const SEL = {
  card: '[data-testid="review-card"]',
  openReviews: '[data-testid="fr-read-all-reviews"], [data-testid="review-score-read-all"], [data-testid="Property-Header-Nav-Tab-Trigger-reviews"]',
  sorter: '[data-testid="review-sorter"] select',
  nextPage: 'button[aria-label="Next page"]',
  replyToggle: '[data-testid="review-pr-toggle"]',
  cookieReject: '#onetrust-reject-all-handler, button:has-text("Decline"), button:has-text("Reject")',
};

async function assertNotBlocked(page) {
  const title = (await page.title()).toLowerCase();
  const body = (await page.locator('body').innerText({ timeout: 5000 }).catch(() => '')).slice(0, 2000).toLowerCase();
  if (/access denied|attention required|are you a robot|verify (?:you are|that you're) (?:a )?human|captcha/.test(`${title} ${body}`)) {
    throw new CollectionError('BLOCKED', 'Booking.com served a bot check instead of the page. Not attempting to bypass it; try again later or run with --headed.');
  }
}

/** Signature of the cards currently shown, to detect that a page change happened. */
const cardSignature = (page) => page.$$eval(SEL.card, (cards) => cards.map((c) => c.textContent.slice(0, 80)).join('|'));

async function waitForCardsToChange(page, previous, timeoutMs = 15000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    await sleep(300);
    const sig = await cardSignature(page).catch(() => '');
    if (sig && sig !== previous) return true;
  }
  return false;
}

async function saveDebugSnapshot(page, slug, debugDir) {
  try {
    fs.mkdirSync(debugDir, { recursive: true });
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const base = path.join(debugDir, `${slug}-${stamp}`);
    await page.screenshot({ path: `${base}.png`, fullPage: false });
    fs.writeFileSync(`${base}.html`, await page.content());
    return base;
  } catch {
    return null;
  }
}

/**
 * @param {import('playwright').BrowserContext} context
 * @param {object} property      entry from config/properties.js
 * @param {object} opts
 * @param {(cards: object[], pageNo: number) => Promise<{newCount: number, rejected: number}>} opts.onPage
 *        persists one page of raw cards and reports how many were new
 * @param {boolean} [opts.full]  ignore "already known" and read up to maxPages
 * @param {number}  [opts.maxPages]
 * @param {number}  [opts.stopAfterKnownPages]
 * @param {(msg: string) => void} [opts.log]
 * @param {string}  [opts.debugDir]
 */
export async function collectProperty(context, property, opts) {
  const { onPage, full = false, maxPages = full ? 500 : 50, stopAfterKnownPages = 2, log = () => {}, debugDir = 'data/debug' } = opts;
  const warnings = [];
  const page = await context.newPage();
  const result = { pagesRead: 0, cardsSeen: 0, newReviews: 0, rejected: 0, header: null, warnings, stoppedBecause: null };

  try {
    await withRetry(async () => {
      await page.goto(listingUrl(property), { waitUntil: 'domcontentloaded', timeout: 45000 });
      await assertNotBlocked(page);
      await page.waitForSelector(SEL.openReviews, { timeout: 20000 });
    }, { label: 'load listing', log });

    const reject = page.locator(SEL.cookieReject).first();
    if (await reject.isVisible({ timeout: 3000 }).catch(() => false)) await reject.click().catch(() => {});

    result.header = await page.evaluate(extractHeader);
    if (!result.header) warnings.push('overall score header not found');

    // Open the review panel. Several entry points exist; try each.
    await withRetry(async () => {
      for (const handle of await page.$$(SEL.openReviews)) {
        await handle.evaluate((el) => (el.closest('button,a') || el).click()).catch(() => {});
        if (await page.waitForSelector(SEL.card, { timeout: 6000 }).then(() => true).catch(() => false)) return;
      }
      await assertNotBlocked(page);
      throw new Error('review list did not open');
    }, { label: 'open reviews', log });

    // Newest first, so incremental runs can stop early.
    let sorted = false;
    if (await page.$(SEL.sorter)) {
      const before = await cardSignature(page);
      const current = await page.$eval(SEL.sorter, (s) => s.value);
      if (current !== 'NEWEST_FIRST') {
        await page.selectOption(SEL.sorter, 'NEWEST_FIRST');
        sorted = await waitForCardsToChange(page, before);
      } else sorted = true;
    }
    if (!sorted) {
      warnings.push('could not sort by newest; reading without early stop');
    }
    const earlyStop = sorted && !full;

    let knownPagesInARow = 0;
    while (result.pagesRead < maxPages) {
      await sleep(jitter(1200, 2500)); // polite pacing

      // Expand truncated hotel replies on this page.
      await page.$$eval(SEL.replyToggle, (btns) => btns.forEach((b) => /continue|read more/i.test(b.textContent) && b.click())).catch(() => {});
      await sleep(300);

      const cards = await page.evaluate(extractReviewCards);
      result.pagesRead++;
      if (!cards.length) {
        if (result.pagesRead === 1) throw new CollectionError('NO_REVIEWS', 'review panel opened but contained no review cards');
        warnings.push(`page ${result.pagesRead} was empty`);
        break;
      }

      // Layout health check: if most cards are missing the core fields, the
      // markup changed. Stop rather than silently storing garbage.
      const broken = cards.filter((c) => !c.score || !c.reviewDate).length;
      if (broken / cards.length > 0.5) {
        const snap = await saveDebugSnapshot(page, property.slug, debugDir);
        throw new CollectionError('LAYOUT_CHANGED', `${broken}/${cards.length} cards on page ${result.pagesRead} lack a score or date; Booking.com markup has probably changed.${snap ? ` Snapshot: ${snap}.*` : ''}`);
      }

      const { newCount, rejected } = await onPage(cards, result.pagesRead);
      result.cardsSeen += cards.length;
      result.newReviews += newCount;
      result.rejected += rejected;
      log(`  page ${result.pagesRead}: ${cards.length} cards, ${newCount} new${rejected ? `, ${rejected} rejected` : ''}`);

      knownPagesInARow = newCount === 0 ? knownPagesInARow + 1 : 0;
      if (earlyStop && knownPagesInARow >= stopAfterKnownPages) {
        result.stoppedBecause = `caught up (${stopAfterKnownPages} pages with nothing new)`;
        break;
      }

      const next = await page.$(SEL.nextPage);
      if (!next || (await next.isDisabled())) {
        result.stoppedBecause = 'reached the last page';
        break;
      }
      const before = await cardSignature(page);
      const moved = await withRetry(async () => {
        await next.click();
        if (!(await waitForCardsToChange(page, before))) throw new Error('next page did not load');
        return true;
      }, { label: `page ${result.pagesRead + 1}`, attempts: 2, log }).catch((err) => {
        warnings.push(`stopped at page ${result.pagesRead}: ${err.message}`);
        return false;
      });
      if (!moved) {
        result.stoppedBecause = 'pagination failed';
        break;
      }
    }
    if (!result.stoppedBecause) result.stoppedBecause = `page limit (${maxPages})`;
    return result;
  } catch (err) {
    if (!(err instanceof CollectionError)) {
      const snap = await saveDebugSnapshot(page, property.slug, debugDir);
      if (snap) err.message += ` (snapshot: ${snap}.*)`;
    }
    err.partialResult = result;
    throw err;
  } finally {
    await page.close().catch(() => {});
  }
}
