/**
 * Keyword topic classifier (the default; no API key or network needed).
 *
 * Booking.com asks guests two separate questions, "What did you like?" and
 * "What didn't you like?". That split gives us polarity for free:
 *   topic mentioned in the disliked text -> complaint
 *   topic mentioned in the liked text    -> praise
 * so the classifier only has to answer "which topics does this text mention?",
 * which keyword rules do reasonably well, rather than "is this sentence
 * positive?", which they do badly.
 */
import { TOPICS } from './taxonomy.js';
import { LATIN_LANGUAGES } from '../language.js';

export const KEYWORD_CLASSIFIER_VERSION = 'kw-3';

const CJK_LANGS = new Set(['zh', 'ja', 'ko', 'th']);
const LATIN = new Set([...LATIN_LANGUAGES, 'xx']);

/**
 * Which i18n keyword lists to run. Guessing between closely related Latin
 * languages from a short review is unreliable, so any non-English Latin text
 * that is short (< 8 words) or unidentified gets all the Latin lists; longer
 * text gets the detected language's list. English text never does: Spanish "caro" must not
 * fire inside English "carousel".
 */
function i18nListsFor(lang, wordCount) {
  if (!lang || lang === 'en') return [];
  if (LATIN.has(lang)) return lang === 'xx' || wordCount < 8 ? LATIN_LANGUAGES : [lang];
  return [lang];
}

function compile(patterns, lang) {
  if (!patterns?.length) return null;
  const body = patterns.join('|');
  // Word-start anchor that also works next to accented letters (JS \b does not).
  if (lang === 'en') return new RegExp(`(?<![\\p{L}\\d])(?:${body})`, 'giu');
  if (CJK_LANGS.has(lang)) return new RegExp(`(?:${body})`, 'giu');
  return new RegExp(`(?<![\\p{L}])(?:${body})`, 'giu');
}

const COMPILED = TOPICS.map((t) => ({
  id: t.id,
  strong: compile(t.strong, 'en'),
  weak: compile(t.weak, 'en'),
  i18n: Object.fromEntries(Object.entries(t.i18n || {}).map(([lang, pats]) => [lang, compile(pats, lang)])),
}));

/**
 * "What didn't you like?" answers that mean "nothing". These must not count
 * as complaints, and they are common: "Nothing, everything was great!".
 */
const NOTHING_TO_DISLIKE = [
  /^(?:nothing|none|nil|nada|n\/?a|na|no|nope|not really|-+|\.+|x)\W*$/i,
  /^nothing\b[^a-z]*(?:really|at all|to (?:dislike|complain(?: about)?|report|mention|say)|bad|negative|much|in particular|comes to mind|specific)?\W*$/i,
  /^nothing\b.{0,15}\b(?:everything|all|it)\b.{0,25}\b(?:great|good|perfect|fine|excellent|amazing|wonderful|ok|okay|lovely)\b/i,
  /^(?:no|zero) (?:complaints?|issues?|problems?|negatives?)\b/i,
  /^(?:all|everything) (?:was )?(?:good|great|perfect|fine|excellent|ok)\b/i,
  /^i (?:had a great stay|have no complaints|loved everything)\b.{0,80}$/i,
  /^(?:nothing|nada) (?:que|da)\b/i, // es/it "nada que destacar", "niente da segnalare"
  /^(?:niente|rien|nichts|nada|无|沒有|没有|ничего)\W*$/i,
];

export function isNothingToDislike(text) {
  if (!text) return true;
  const t = text.trim();
  if (t.length > 120) return false;
  return NOTHING_TO_DISLIKE.some((re) => re.test(t));
}

/**
 * "What did you like?" answers that carry no praise. Unhappy guests often
 * write "Nothing, filthiest place ever" here; without this rule "filth" would
 * be counted as cleanliness praise.
 */
const NOTHING_LIKED = [
  /^(?:none|n\/?a|-+|\.+|0|no breakfast|didn'?t have breakfast|did not have breakfast)\W*$/i,
  /^(?:absolutely |literally |honestly |really )?(?:nothing|nada|niente|rien|nichts|ingenting|nic|nothin)\b/i,
  /^there (?:is|was) nothing (?:to like|good)/i,
];
const isNothingLiked = (text) => NOTHING_LIKED.some((re) => re.test(text.trim()));

const CLAUSE_SPLIT = /[.!?;\n]+|,|\s(?:but|however|although|though|except)\s|，|。|！|？|；/i;

function matchAll(re, text) {
  if (!re) return [];
  re.lastIndex = 0;
  return [...text.matchAll(re)].map((m) => m[0].toLowerCase());
}

/**
 * Which topics does a piece of text mention?
 * @returns {Record<string, string[]>} topic id -> matched terms (for explainability)
 */
export function topicsInText(text, language = 'en') {
  const found = {};
  if (!text) return found;
  const add = (id, terms) => {
    if (!terms.length) return;
    found[id] = [...new Set([...(found[id] || []), ...terms])];
  };

  const wordCount = text.split(/\s+/).length;
  for (const clause of text.split(CLAUSE_SPLIT)) {
    if (!clause || !clause.trim()) continue;
    const strongHits = {};
    const lists = i18nListsFor(language, wordCount);
    for (const t of COMPILED) {
      const hits = [...matchAll(t.strong, clause)];
      for (const l of lists) if (t.i18n[l]) hits.push(...matchAll(t.i18n[l], clause));
      if (hits.length) strongHits[t.id] = hits;
    }
    for (const [id, hits] of Object.entries(strongHits)) add(id, hits);
    // Weak terms only count when the clause has no stronger topic signal at all.
    if (Object.keys(strongHits).length === 0) {
      for (const t of COMPILED) add(t.id, matchAll(t.weak, clause));
    }
  }
  return found;
}

/**
 * @param {{positive?: string|null, negative?: string|null, title?: string|null, sentiment?: string|null, language?: string|null}} review
 */
export function classifyKeyword(review) {
  const lang = review.language || 'en';
  const negativeText = review.negative && !isNothingToDislike(review.negative) ? review.negative : null;
  const positiveText = review.positive && !isNothingLiked(review.positive) ? review.positive : null;

  const complaintsFound = topicsInText(negativeText, lang);
  const praiseFound = topicsInText(positiveText, lang);

  // Rating-only reviews sometimes put the whole complaint in the title
  // ("Dirty bathrooms and no lift"). Use the title only when there is no
  // body text, and take its polarity from the score.
  if (!review.positive && !review.negative && review.title) {
    const fromTitle = topicsInText(review.title, lang);
    const target = review.sentiment === 'negative' ? complaintsFound : review.sentiment === 'positive' ? praiseFound : null;
    if (target) for (const [id, terms] of Object.entries(fromTitle)) target[id] = terms;
  }

  const order = (obj) => TOPICS.map((t) => t.id).filter((id) => obj[id]);
  return {
    complaints: order(complaintsFound),
    praise: order(praiseFound),
    evidence: { complaints: complaintsFound, praise: praiseFound },
    nothingToDislike: !!review.negative && !negativeText,
    method: 'keyword',
    version: KEYWORD_CLASSIFIER_VERSION,
  };
}
