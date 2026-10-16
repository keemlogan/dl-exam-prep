import { ROOT } from "../common/api.js";
// Slide references → slide images (/data/slides/<stem>/p-NN.jpg, SPEC §1). Pure: no DOM.

/** ref prefix → slide folder (SPEC §1). */
export const STEMS = {
  "lec01-1": "lec01-1-course-intro",
  "lec01-2": "lec01-2-dl-intro",
  "lec02-1": "lec02-1-ml-basics",
  "lec02-2": "lec02-2-colab-intro",
  "lec02-3": "lec02-3-ex-background-mathematics",
  "lec02-4": "lec02-4-linear-regression",
  "lec03-1": "lec03-1-regularization",
  "lec03-2": "lec03-2-how-dl-works",
  "lec03-3": "lec03-3-first-neural-networks",
  "lec04-1": "lec04-1-gradient-based-optimization",
  "lec04-2": "lec04-2-multilayer-perceptron",
  "lec05-1": "lec05-1-pytorch-in-1h",
  "lec05-2": "lec05-2-binary-classification-movie-reviews",
  "lec06-1": "lec06-1-optimizers",
  "lec07-1": "lec07-1-convolution-and-pooling",
  "lec07-2": "lec07-2-deep-learning-for-computer-vision",
};

/** Pages per deck (count of p-NN.jpg in data/slides/<stem>/). */
export const SLIDE_PAGES = {
  "lec01-1": 11, "lec01-2": 24, "lec02-1": 31, "lec02-2": 3, "lec02-3": 7, "lec02-4": 8, "lec03-1": 14, "lec03-2": 14,
  "lec03-3": 26, "lec04-1": 13, "lec04-2": 37, "lec05-1": 29, "lec05-2": 25, "lec06-1": 32, "lec07-1": 32, "lec07-2": 46,
};

/** Page images are 1000 px wide; these decks are tall (notes-style pages, 1000×1295), the rest 16:9 (1000×563). */
const TALL = new Set(["lec02-3", "lec03-3", "lec04-1", "lec05-1", "lec05-2", "lec07-2"]);
export function slideSize({ lec }) {
  return { w: 1000, h: TALL.has(lec) ? 1295 : 563 };
}

const RANGE_CAP = 30;

export function slideUrl({ lec, page }) {
  return `${ROOT}data/slides/${STEMS[lec] || lec}/p-${String(page).padStart(2, "0")}.jpg`;
}

export function slideLabel({ lec, page }) {
  return `${lec} p.${page}`;
}

function pagesOf(lec, from, to) {
  const out = [];
  const last = Math.min(to ?? from, from + RANGE_CAP - 1);
  for (let p = from; p <= last; p++) if (p >= 1 && p <= (SLIDE_PAGES[lec] || 0)) out.push(p);
  return out;
}

/** `[{lec, page, at}]` in text order; `at` = index of the match (used to merge with other matches). */
function scanRefs(str) {
  const out = [];
  let lec = null;
  const re = /(?<![A-Za-z])lec(\d{2}-\d)(?!\d)|(?<![A-Za-z])p\.\s*(\d+)(?:\s*[–-]\s*(\d+))?/g;
  for (const m of String(str ?? "").matchAll(re)) {
    if (m[1]) lec = `lec${m[1]}`;
    else if (lec && STEMS[lec]) for (const page of pagesOf(lec, Number(m[2]), m[3] && Number(m[3]))) out.push({ lec, page, at: m.index });
  }
  return out;
}

function dedupe(list) {
  const seen = new Set();
  return list.filter(({ lec, page }) => {
    const key = `${lec}:${page}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/**
 * "lec05-1 p.21; lec07-2 p.13" → [{lec:"lec05-1",page:21},{lec:"lec07-2",page:13}]. Left to right: "lecNN-N"
 * sets the current deck, "p.N" adds a page, "p.N–M" / "p.N-M" a range (at most 30 pages). Pages that do not
 * exist are dropped; "p.N" before any deck is ignored; a deck without pages ("lec03-3") adds nothing.
 */
export function parseSlideRefs(str) {
  return dedupe(scanRefs(str)).map(({ lec, page }) => ({ lec, page }));
}

/**
 * Slides an explanation points at: explicit "lecNN-N p.N" citations, plus "슬라이드 p.N" (deck taken from the
 * question's ref). Text order, no repeats.
 */
export function mentionedSlides(explanation, ref) {
  const text = String(explanation ?? "");
  const defLec = scanRefs(ref)[0]?.lec || (/lec(\d{2}-\d)/.exec(ref || "") || [])[0] || null;
  const found = [];
  for (const m of text.matchAll(/슬라이드\s*p\.?\s*(\d+)(?:\s*[–-]\s*(\d+))?/g)) {
    if (!defLec || !STEMS[defLec]) continue;
    for (const page of pagesOf(defLec, Number(m[1]), m[2] && Number(m[2]))) found.push({ lec: defLec, page, at: m.index });
  }
  found.push(...scanRefs(text));
  found.sort((a, b) => a.at - b.at);
  return dedupe(found).map(({ lec, page }) => ({ lec, page }));
}

/** The pages before/after `s` in its deck (for the viewer when only one page was cited). */
export function deckPages(lec) {
  return Array.from({ length: SLIDE_PAGES[lec] || 0 }, (_, i) => ({ lec, page: i + 1 }));
}
