/**
 * Very small language guesser, used only to (a) choose which keyword lists
 * apply and (b) show ops staff that a review is not in English.
 * Script detection handles CJK/Cyrillic/etc. reliably; Latin-script languages
 * are guessed from common function words. Short texts default to English.
 */
const STOPWORDS = {
  en: ['the', 'and', 'was', 'is', 'very', 'room', 'for', 'with', 'but', 'not', 'were', 'it', 'to', 'of', 'staff', 'good', 'great', 'nice', 'location', 'clean'],
  es: ['el', 'la', 'los', 'las', 'muy', 'pero', 'con', 'una', 'habitación', 'es', 'era', 'para', 'del', 'que', 'bien', 'ubicación', 'limpio'],
  it: ['il', 'lo', 'gli', 'della', 'molto', 'ma', 'con', 'una', 'camera', 'è', 'era', 'per', 'che', 'posizione', 'pulita', 'non'],
  fr: ['le', 'les', 'des', 'très', 'mais', 'avec', 'une', 'chambre', 'est', 'était', 'pour', 'que', 'bien', 'propre', 'pas'],
  de: ['der', 'die', 'das', 'und', 'sehr', 'aber', 'mit', 'ein', 'eine', 'zimmer', 'ist', 'war', 'für', 'nicht', 'gut', 'sauber'],
  pt: ['o', 'os', 'muito', 'mas', 'com', 'uma', 'quarto', 'é', 'era', 'para', 'não', 'bom', 'limpo', 'localização'],
  nl: ['de', 'het', 'een', 'zeer', 'maar', 'met', 'kamer', 'is', 'was', 'niet', 'goed', 'schoon', 'erg', 'heel'],
  sv: ['och', 'det', 'att', 'är', 'var', 'inte', 'mycket', 'rummet', 'en', 'som', 'på', 'av', 'för', 'med', 'bra'],
  no: ['og', 'det', 'er', 'var', 'ikke', 'veldig', 'rommet', 'som', 'på', 'av', 'for', 'med', 'bra', 'utrolig'],
  da: ['og', 'det', 'er', 'var', 'ikke', 'meget', 'værelset', 'som', 'på', 'af', 'for', 'med', 'god'],
  pl: ['i', 'w', 'nie', 'na', 'się', 'było', 'jest', 'bardzo', 'pokój', 'że', 'z', 'do', 'ale'],
};

/** Latin-script languages other than English. */
export const LATIN_LANGUAGES = ['es', 'it', 'fr', 'de', 'pt', 'nl', 'sv', 'no', 'da', 'pl'];
const NON_ENGLISH_LETTERS = /[àáâãäåæçèéêëìíîïñòóôõöøùúûüýÿœßąćęłńśźżčřšžı]/i;

export function detectLanguage(text) {
  if (!text || !text.trim()) return null;
  const t = text.toLowerCase();
  const count = (re) => (t.match(re) || []).length;
  const letters = count(/\p{L}/gu) || 1;
  if (count(/[぀-ヿ]/g) / letters > 0.1) return 'ja';
  if (count(/[가-힯]/g) / letters > 0.2) return 'ko';
  if (count(/[一-鿿]/g) / letters > 0.2) return 'zh';
  if (count(/[Ѐ-ӿ]/g) / letters > 0.3) return 'ru';
  if (count(/[؀-ۿ]/g) / letters > 0.3) return 'ar';
  if (count(/[฀-๿]/g) / letters > 0.3) return 'th';
  if (count(/[֐-׿]/g) / letters > 0.3) return 'he';

  const words = t.split(/[^\p{L}]+/u).filter(Boolean);
  let best = 'en';
  let bestScore = 0;
  for (const [lang, list] of Object.entries(STOPWORDS)) {
    const set = new Set(list);
    const score = words.filter((w) => set.has(w)).length / (words.length || 1);
    if (score > bestScore + (lang === 'en' ? 0 : 0.02)) {
      best = lang;
      bestScore = score;
    }
  }
  // No function words recognised: accented letters suggest a non-English
  // Latin-script language we can't pin down ("xx"); otherwise assume English.
  if (bestScore === 0) return NON_ENGLISH_LETTERS.test(t) ? 'xx' : 'en';
  // Very short texts: only trust a non-English guess if it has accented letters.
  if (words.length < 3 && best !== 'en' && !NON_ENGLISH_LETTERS.test(t)) return 'en';
  return best;
}

export const LANGUAGE_NAMES = {
  en: 'English', es: 'Spanish', it: 'Italian', fr: 'French', de: 'German', pt: 'Portuguese',
  nl: 'Dutch', sv: 'Swedish', no: 'Norwegian', da: 'Danish', pl: 'Polish', xx: 'Other (Latin script)', zh: 'Chinese', ja: 'Japanese', ko: 'Korean', ru: 'Russian', ar: 'Arabic', th: 'Thai', he: 'Hebrew',
};
