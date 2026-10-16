// Adaptive learning engine for the written trainer — implements SPEC.md §5.
// No DOM, no globals: every function works on the plain state object it is given (mutating it where the
// name says so) and randomness is injected (`rng`), so node tests can replay a whole study session.

export const PRIOR = 0.2;
export const TRANSIT = 0.15;
export const SLIP = 0.1;
export const MASTERY_P = 0.95;
export const FIRST_REVIEW = 8;      // first spaced review comes after 8 more questions
export const REVIEW_GROWTH = 2.2;   // interval multiplier on each correct review
export const REVIEW_GAP = 3;        // at most one review per 4 questions
export const FOCUS_MAX = 12;        // questions in a row on one focus concept before rotating
export const RECENT = 15;           // never repeat a question seen in the last 15 answers (if avoidable)
export const REST = 15;             // a rotated-out concept sits out this many answers
export const HISTORY_MAX = 5000;

/** Seedable PRNG (mulberry32) — returns a function like Math.random. */
export function mulberry32(seed) {
  let a = seed >>> 0;
  return function rng() {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** BKT guess probability by question type (SPEC §5). */
export function guessFor(q) {
  switch (q.type) {
    case "ox": return 0.5;
    case "choice": return 1 / Math.max(2, (q.choices || []).length);
    case "multi": return 0.1;
    case "numeric": return 0.03;
    case "steps": return 0.03;
    case "written": return 0.2;
    case "output": return 0.03;
    default: return 0.1;
  }
}

/** One Bayesian Knowledge Tracing step: posterior given the answer, then the learning transition. */
export function bkt(p, correct, guess) {
  const post = correct
    ? (p * (1 - SLIP)) / (p * (1 - SLIP) + (1 - p) * guess)
    : (p * SLIP) / (p * SLIP + (1 - p) * (1 - guess));
  return post + (1 - post) * TRANSIT;
}

export function newConcept() {
  return { p: PRIOR, level: 2, n: 0, correct: 0, streak: 0, wrongStreak: 0, l3Correct: 0,
    status: "new", interval: 0, due: null, lastAt: null };
}

export function createState() {
  return { v: 1, step: 0, concepts: {}, q: {}, history: [], focus: null, rest: {}, lastReviewAt: -100 };
}

/** Fill in fields missing from a saved state (older saves, hand edits). */
export function normalizeState(raw) {
  const s = { ...createState(), ...(raw && typeof raw === "object" ? raw : {}) };
  for (const key of ["concepts", "q", "rest"]) if (!s[key] || typeof s[key] !== "object") s[key] = {};
  if (!Array.isArray(s.history)) s.history = [];
  for (const [cid, cs] of Object.entries(s.concepts)) s.concepts[cid] = { ...newConcept(), ...cs };
  if (!Number.isFinite(s.step)) s.step = s.history.length;
  if (!Number.isFinite(s.lastReviewAt)) s.lastReviewAt = -100;
  return s;
}

/** Read a concept's state without creating it. */
export function peekConcept(state, cid) {
  return state.concepts[cid] || newConcept();
}

function ensureConcept(state, cid) {
  return (state.concepts[cid] ||= newConcept());
}

/** Index a bundle (`{concepts, questions}`) for fast lookups. */
export function indexBank(bundle) {
  const concepts = (bundle.concepts || []).slice().sort((a, b) => a.order - b.order);
  const questions = bundle.questions || [];
  const byId = new Map();
  const byConcept = {};
  for (const c of concepts) byConcept[c.id] = [];
  for (const q of questions) {
    byId.set(q.id, q);
    (byConcept[q.concept] ||= []).push(q);
  }
  const conceptById = Object.fromEntries(concepts.map((c) => [c.id, c]));
  return { concepts, conceptById, questions, byId, byConcept };
}

/** Level-3 correct answers needed for mastery: 2, or fewer if the bank does not have 2 level-3 questions yet. */
export function l3Needed(bank, cid) {
  if (!bank) return 2;
  const n = (bank.byConcept[cid] || []).filter((q) => q.level === 3).length;
  return Math.min(2, n);
}

/**
 * Record one graded answer. Mutates `state`; returns what the UI needs to react:
 * `{pBefore, pAfter, levelBefore, levelAfter, review, mastered, demoted, showCard, rotated}`.
 * `result` = `{correct, score}` from grade.js. Partial credit (multi, steps, written) counts as correct only when
 * the type's own rule holds (`result.correct`).
 */
export function recordAnswer(state, q, result, meta = {}, bank = null) {
  const cs = ensureConcept(state, q.concept);
  const step = state.step;
  const mode = meta.mode || "learn";
  const correct = !!result.correct;
  const pBefore = cs.p;
  const levelBefore = cs.level;
  const review = cs.status === "mastered"; // any answer on a mastered concept is a review

  cs.p = bkt(cs.p, correct, guessFor(q));
  cs.n += 1;
  cs.lastAt = step;
  if (correct) {
    cs.correct += 1;
    cs.streak += 1;
    cs.wrongStreak = 0;
    if (q.level === 3) cs.l3Correct += 1;
  } else {
    cs.streak = 0;
    cs.wrongStreak += 1;
  }
  cs.level = correct ? Math.min(3, cs.level + 1) : Math.max(1, cs.level - 1);

  let mastered = false;
  let demoted = false;
  if (review) {
    state.lastReviewAt = step;
    if (correct) {
      cs.interval = Math.max(FIRST_REVIEW, cs.interval) * REVIEW_GROWTH;
      cs.due = step + 1 + Math.round(cs.interval);
    } else {
      cs.status = "learning";
      cs.level = 2;
      cs.p = Math.min(cs.p, 0.6);
      cs.interval = 0;
      cs.due = null;
      demoted = true;
    }
  } else {
    cs.status = "learning";
    if (cs.p >= MASTERY_P && cs.l3Correct >= l3Needed(bank, q.concept) && cs.streak >= 2) {
      cs.status = "mastered";
      cs.interval = FIRST_REVIEW;
      cs.due = step + 1 + FIRST_REVIEW;
      mastered = true;
    }
  }

  // focus bookkeeping: only questions served as the focus (learn mode, not a review) count toward the cap
  let rotated = false;
  const f = state.focus;
  if (f && f.cid === q.concept) {
    if (mode === "learn" && !review) f.count += 1;
    if (cs.status === "mastered") {
      state.focus = null;
    } else if (f.count >= FOCUS_MAX) {
      state.rest[q.concept] = step + 1 + REST;
      state.focus = null;
      rotated = true;
    }
  }

  const qs = (state.q[q.id] ||= { n: 0, wrong: 0, lastAt: null, wrongAt: null, last: null });
  qs.n += 1;
  qs.lastAt = step;
  qs.last = correct;
  if (!correct) {
    qs.wrong += 1;
    qs.wrongAt = step;
  }

  const entry = { t: meta.t ?? Date.now(), qid: q.id, concept: q.concept, level: q.level, format: q.format,
    type: q.type, correct, score: result.score ?? (correct ? 1 : 0), ms: meta.ms ?? 0, mode };
  if (review) entry.review = true;
  state.history.push(entry);
  if (state.history.length > HISTORY_MAX) state.history.splice(0, state.history.length - HISTORY_MAX);
  state.step = step + 1;

  const showCard = !correct && cs.wrongStreak >= 2 && (cs.wrongStreak - 2) % 3 === 0;
  return { pBefore, pAfter: cs.p, levelBefore, levelAfter: cs.level, review, mastered, demoted, showCard, rotated };
}

/** Question ids answered in the last `n` answers. */
export function recentIds(state, n = RECENT) {
  const out = new Set();
  const h = state.history;
  for (let i = h.length - 1; i >= 0 && h.length - i <= n; i--) out.add(h[i].qid);
  return out;
}

function levelOrder(level) {
  return [level, level - 1, level + 1, level - 2, level + 2].filter((l) => l >= 1 && l <= 3);
}

/**
 * Pick a question inside one concept: the concept's current level (nearest level, easier first, when that
 * level has nothing left), unseen first, then previously wrong (oldest first), then least recently seen;
 * questions in `recent` are skipped. Returns null when every question is recent.
 */
export function pickInConcept(state, list, level, recent, rng) {
  const avail = list.filter((q) => !recent.has(q.id));
  if (!avail.length) return null;
  for (const lv of levelOrder(level)) {
    const pool = avail.filter((q) => q.level === lv);
    if (!pool.length) continue;
    const unseen = pool.filter((q) => !state.q[q.id]);
    if (unseen.length) return unseen[Math.floor(rng() * unseen.length)];
    const rank = (q) => {
      const s = state.q[q.id];
      if (s.last === false) return [0, s.wrongAt];
      if (s.wrong > 0) return [1, s.lastAt];
      return [2, s.lastAt];
    };
    return pool.slice().sort((a, b) => {
      const ra = rank(a), rb = rank(b);
      return ra[0] - rb[0] || ra[1] - rb[1];
    })[0];
  }
  return null;
}

function leastRecent(state, list) {
  let best = null;
  let bestAt = Infinity;
  for (const q of list) {
    const at = state.q[q.id]?.lastAt ?? -1;
    if (at < bestAt) { best = q; bestAt = at; }
  }
  return best;
}

/** Focus priority for a non-mastered concept (SPEC §5). */
export function focusScore(cs, concept, nConcepts) {
  return (1 - cs.p) * (cs.status === "learning" ? 1 : 0.7) + 0.25 * (1 - concept.order / nConcepts);
}

/** Non-mastered concepts that have questions, best focus candidate first. */
export function rankFocus(state, bank, { ignoreRest = false } = {}) {
  const n = Math.max(1, bank.concepts.length); // the bank's concept count (33 in the real bank)
  const rows = [];
  for (const c of bank.concepts) {
    if (!(bank.byConcept[c.id] || []).length) continue;
    const cs = peekConcept(state, c.id);
    if (cs.status === "mastered") continue;
    if (!ignoreRest && (state.rest[c.id] ?? -1) > state.step) continue;
    rows.push({ cid: c.id, score: focusScore(cs, c, n), order: c.order });
  }
  rows.sort((a, b) => b.score - a.score || a.order - b.order);
  return rows.map((r) => r.cid);
}

/**
 * Choose the next question for adaptive study. May update `state.focus` / `state.rest`.
 * Order: (1) a due review unless one was shown in the last 3 questions, (2) the focus concept until it is
 * mastered (max 12 in a row), (3) a new focus by `focusScore`, (4) mastered concepts earliest-due first
 * (reason "extra" when nothing is due yet — the student has mastered everything),
 * (5) anything not recent, (6) the least recently seen question.
 * `only` restricts to one concept ("이 개념만 연습"). Returns `{q, reason}` or null for an empty bank.
 */
export function nextQuestion(state, bank, { rng = Math.random, only = null, exclude = [] } = {}) {
  const recent = recentIds(state);
  for (const id of exclude) recent.add(id);
  const step = state.step;
  const order = (cid) => bank.conceptById[cid]?.order ?? 999;
  const pick = (cid) => pickInConcept(state, bank.byConcept[cid] || [], peekConcept(state, cid).level, recent, rng);

  if (only) {
    const list = bank.byConcept[only] || [];
    const q = pick(only) || leastRecent(state, list.filter((x) => !exclude.includes(x.id))) || leastRecent(state, list);
    return q ? { q, reason: "practice" } : null;
  }

  const masteredByDue = Object.entries(state.concepts)
    .filter(([cid, cs]) => cs.status === "mastered" && (bank.byConcept[cid] || []).length)
    .sort((a, b) => (a[1].due ?? 0) - (b[1].due ?? 0) || order(a[0]) - order(b[0]));

  // (1) due review
  if (state.lastReviewAt < step - REVIEW_GAP) {
    for (const [cid, cs] of masteredByDue) {
      if (cs.due == null || cs.due > step) continue;
      const q = pick(cid);
      if (q) return { q, reason: "review" };
    }
  }

  // (2) current focus
  if (state.focus) {
    const cid = state.focus.cid;
    if (peekConcept(state, cid).status !== "mastered" && (bank.byConcept[cid] || []).length) {
      const q = pick(cid);
      if (q) return { q, reason: "focus" };
      state.rest[cid] = step + REST; // every question is recent: rotate now, come back later
    }
    state.focus = null;
  }

  // (3) new focus
  let ranked = rankFocus(state, bank);
  if (!ranked.length) ranked = rankFocus(state, bank, { ignoreRest: true });
  for (const cid of ranked) {
    const q = pick(cid);
    if (q) {
      state.focus = { cid, count: 0 };
      return { q, reason: "focus" };
    }
  }

  // (4) everything left is mastered (or exhausted): keep reviewing, earliest due first
  for (const [cid, cs] of masteredByDue) {
    const q = pick(cid);
    if (q) return { q, reason: cs.due != null && cs.due <= step ? "review" : "extra" };
  }

  // (5) anything not recent, (6) least recently seen
  const fresh = bank.questions.filter((q) => !recent.has(q.id));
  const q = leastRecent(state, fresh.length ? fresh : bank.questions);
  return q ? { q, reason: "fallback" } : null;
}

// ---- mock exam ------------------------------------------------------------------------------------

/**
 * The paper (SPEC §5): 120 minutes, 100 points.
 *   tf       10 ox (format tf)        2 each, wrong −2, 비워두기 0, section total ≥ 0
 *   steps     1 steps                 20, partial by field
 *   calc      3 numeric (format calc)  5 each, partial by field
 *   written   4 written               5 each, self-graded rubric fraction
 *   code      5 output / choice|numeric with code   5 each, all-or-nothing
 */
export const MOCK_PLAN = [
  { section: "tf", n: 10, pts: 2 },
  { section: "steps", n: 1, pts: 20 },
  { section: "calc", n: 3, pts: 5 },
  { section: "written", n: 4, pts: 5 },
  { section: "code", n: 5, pts: 5 },
];
export const MOCK_MINUTES = 120;

const hasCode = (q) => typeof q.code === "string" && q.code.trim() !== "";

export function fitsSection(q, section) {
  switch (section) {
    case "tf": return q.type === "ox" && q.format === "tf";
    case "steps": return q.type === "steps";
    case "calc": return q.type === "numeric" && q.format === "calc" && !hasCode(q);
    case "written": return q.type === "written";
    case "code": return q.type === "output" || ((q.type === "choice" || q.type === "numeric") && hasCode(q));
    default: return false;
  }
}

function weightedPick(items, weights, rng) {
  const total = weights.reduce((a, b) => a + b, 0);
  let r = rng() * total;
  for (let i = 0; i < items.length; i++) {
    r -= weights[i];
    if (r <= 0) return items[i];
  }
  return items[items.length - 1];
}

/**
 * Build the mock exam: weaker concepts and levels 2–3 are more likely, concepts spread out (a concept already
 * used in the same section is rare, in another section less likely), recently seen questions rarely.
 * Returns `[{qid, section, pts}]` in paper order (shorter if the bank lacks a type).
 */
export function buildMock(state, bank, rng = Math.random) {
  const recent = recentIds(state);
  const used = new Set();
  const usedConcepts = new Map(); // cid → sections it already appears in
  const items = [];
  for (const sec of MOCK_PLAN) {
    for (let i = 0; i < sec.n; i++) {
      const pool = bank.questions.filter((q) => fitsSection(q, sec.section) && !used.has(q.id));
      if (!pool.length) break;
      const weights = pool.map((q) => {
        let w = 0.3 + (1 - peekConcept(state, q.concept).p);
        if (q.level >= 2) w *= 2;
        if (q.level === 3) w *= 1.5;
        const secs = usedConcepts.get(q.concept);
        if (secs) w *= secs.has(sec.section) ? 0.05 : 0.4;
        if (recent.has(q.id)) w *= 0.1;
        return w;
      });
      const q = weightedPick(pool, weights, rng);
      used.add(q.id);
      if (!usedConcepts.has(q.concept)) usedConcepts.set(q.concept, new Set());
      usedConcepts.get(q.concept).add(sec.section);
      items.push({ qid: q.id, section: sec.section, pts: sec.pts });
    }
  }
  return items;
}

/**
 * Points for one mock item before the section floor: tf +pts / −pts / 0 when skipped or unanswered; code
 * all-or-nothing; steps, calc and written by score (field fraction / rubric fraction).
 */
export function mockPoints(item, result) {
  if (!result || result.unanswered || result.skipped) return 0;
  if (item.section === "tf") return result.correct ? item.pts : -item.pts;
  if (item.section === "code") return result.correct ? item.pts : 0;
  return item.pts * Math.min(1, Math.max(0, result.score ?? (result.correct ? 1 : 0)));
}

/**
 * Totals: `{sections: {key: {got, max, raw, n}}, total, max}`. Each section total is floored at 0 (T/F
 * penalties never eat into other sections).
 */
export function mockTotals(items, resultsByQid) {
  const sections = {};
  for (const it of items) {
    const row = (sections[it.section] ||= { got: 0, max: 0, raw: 0, n: 0 });
    row.raw += mockPoints(it, resultsByQid[it.qid]);
    row.max += it.pts;
    row.n += 1;
  }
  let total = 0;
  let max = 0;
  for (const row of Object.values(sections)) {
    row.got = Math.max(0, row.raw);
    total += row.got;
    max += row.max;
  }
  return { sections, total, max };
}

// ---- summaries for home and dashboard ----------------------------------------------------------------

/**
 * Mastery shown to the student (0–1) — the one number every screen uses. 1 only when actually mastered;
 * otherwise p rescaled from the prior (0) to the mastery bar (1), capped by level-3 progress (0.6 with no
 * level-3 correct, 0.85 with one, 0.95 once `l3Need` are done). Unseen = 0, and a wrong answer never shows a gain.
 * The engine's internal `p` and the mastery rule are unchanged.
 */
export function displayMastery(cs, l3Need = 2) {
  if (!cs || cs.n === 0) return 0;
  if (cs.status === "mastered") return 1;
  const cap = cs.l3Correct >= l3Need ? 0.95 : cs.l3Correct === 0 ? 0.6 : 0.85;
  return Math.min(Math.max((cs.p - PRIOR) / (MASTERY_P - PRIOR), 0), cap);
}

/** `displayMastery` for one concept of a state, with the bank's level-3 availability. */
export function masteryOf(state, cid, bank = null) {
  return displayMastery(state.concepts[cid], l3Needed(bank, cid));
}

/** What is still missing before a concept counts as mastered (for the hint under the mastery bar). */
export function masteryHint(cs, l3Need = 2) {
  if (!cs || cs.status === "mastered") return null;
  const left = l3Need - (cs.l3Correct || 0);
  if (left > 0) return `실전(3단계) 문제를 ${left}개 더 맞히면 완료할 수 있어요`;
  return "이어서 두 문제 연속으로 맞히면 완료할 수 있어요";
}

export function conceptStatus(cs) {
  if (!cs || cs.n === 0) return "new";
  return cs.status === "mastered" ? "mastered" : "learning";
}

/** Overall numbers shared by the home page and the dashboard. `concepts` = the 33 concept records. */
export function summarize(state, concepts, bank = null) {
  const s = state || createState();
  let sum = 0;
  let mastered = 0;
  let started = 0;
  for (const c of concepts) {
    const cs = s.concepts[c.id];
    sum += displayMastery(cs, l3Needed(bank, c.id));
    if (cs?.status === "mastered") mastered += 1;
    if (cs?.n) started += 1;
  }
  const answered = s.history.length;
  const right = s.history.filter((h) => h.correct).length;
  return {
    overall: concepts.length ? sum / concepts.length : 0,
    mastered, started, total: concepts.length, answered,
    accuracy: answered ? right / answered : null,
    focus: s.focus?.cid ?? null,
  };
}

/** Rolling accuracy (window `win`) at each of the last `last` answers — the dashboard trend line. */
export function rollingAccuracy(history, last = 50, win = 10) {
  const start = Math.max(0, history.length - last);
  const out = [];
  for (let i = start; i < history.length; i++) {
    const from = Math.max(0, i - win + 1);
    let ok = 0;
    for (let j = from; j <= i; j++) if (history[j].correct) ok += 1;
    out.push(ok / (i - from + 1));
  }
  return out;
}

/** `{key: {n, correct}}` grouped by a history field (e.g. "format"). */
export function accuracyBy(history, field) {
  const out = {};
  for (const h of history) {
    const row = (out[h[field]] ||= { n: 0, correct: 0 });
    row.n += 1;
    if (h.correct) row.correct += 1;
  }
  return out;
}

/** Questions whose latest attempt was wrong, most recent first: `[{qid, at, wrong, t}]`. */
export function wrongList(state) {
  const latest = new Map();
  for (const h of state.history) latest.set(h.qid, h);
  return [...latest.values()]
    .filter((h) => !h.correct)
    .sort((a, b) => b.t - a.t)
    .map((h) => ({ qid: h.qid, t: h.t, wrong: state.q[h.qid]?.wrong ?? 1 }));
}
