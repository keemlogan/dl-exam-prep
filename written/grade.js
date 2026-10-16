// Pure grading for every question type (SPEC.md §3.4). No DOM.
//
// Answer shapes (what the question view produces):
//   ox      {value: true|false} or {skip: true} (mock 비워두기: 0 points, no penalty)
//   choice  {index: <original choice index>}          multi {picks: [original indices]} or {skip: true}
//   numeric {vals: ["0.5", "1/3", …]}                  (one typed string per field)
//   steps   {steps: [["…", …], …], checked: <steps checked one at a time; learn mode>}
//   written {text, revealed: bool, ticks: [rubric indices the student ticked]}
//   output  {text}
//   any     {dontKnow: true}                            (모르겠어요)
// Result: {correct, score (0–1), note?, ...detail for the feedback sheet}
import { evalExpr } from "./expr.js";

export { evalExpr, fmtNum, isPlainNumber } from "./expr.js";

export const SPACING_NOTE = "띄어쓰기/줄바꿈 주의";

/** Display order of choices: shuffled for single-answer choice questions unless `shuffle: false`. */
export function choiceOrder(q, rng = Math.random) {
  const order = [...Array((q.choices || []).length).keys()];
  if (q.type !== "choice" || q.shuffle === false) return order;
  for (let i = order.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [order[i], order[j]] = [order[j], order[i]];
  }
  return order;
}

const filled = (s) => typeof s === "string" && s.trim() !== "";

/**
 * Has the student given something gradable? (The mock exam counts unanswered questions with this.)
 * numeric/steps: at least one field typed; written: some text, or the model answer was opened.
 */
export function isAnswered(q, a) {
  if (!a) return false;
  if (a.dontKnow) return true;
  switch (q.type) {
    case "ox": return typeof a.value === "boolean" || !!a.skip;
    case "choice": return Number.isInteger(a.index);
    case "output": return typeof a.text === "string" && a.text.trim() !== "";
    case "multi": return !!a.skip || (Array.isArray(a.picks) && a.picks.length > 0);
    case "numeric": return Array.isArray(a.vals) && a.vals.some(filled);
    case "steps": return (a.checked || 0) > 0 || (Array.isArray(a.steps) && a.steps.some((s) => Array.isArray(s) && s.some(filled)));
    case "written": return !!a.revealed || filled(a.text);
    default: return false;
  }
}

// ---- numeric ------------------------------------------------------------------------------------------

/** Absolute tolerance of a field: `tol` if the author set it, else 0 for integers and max(0.01, 1% of |answer|). */
export function fieldTol(f) {
  if (Number.isFinite(f?.tol)) return Math.abs(f.tol);
  const ans = Number(f?.answer);
  if (Number.isInteger(ans)) return 0;
  return Math.max(0.01, 0.01 * Math.abs(ans));
}

/** One field: `{given, value, answer, tol, ok, label, unit}`. */
export function gradeField(f, given) {
  const value = evalExpr(given);
  const answer = Number(f.answer);
  const tol = fieldTol(f);
  const ok = Number.isFinite(value) && Math.abs(value - answer) <= tol + 1e-9 * Math.max(1, Math.abs(answer));
  return { label: f.label ?? "", unit: f.unit ?? "", given: String(given ?? ""), value, answer, tol, ok };
}

export function gradeNumeric(q, a) {
  const fields = (q.fields || []).map((f, i) => gradeField(f, a?.vals?.[i]));
  const ok = fields.filter((x) => x.ok).length;
  return { correct: fields.length > 0 && ok === fields.length, score: fields.length ? ok / fields.length : 0, fields, right: ok, total: fields.length };
}

/** Score = correct fields / all fields over every step; correct when score ≥ 0.75. */
export const STEPS_PASS = 0.75;
export function gradeStep(step, vals) {
  const fields = (step.fields || []).map((f, i) => gradeField(f, vals?.[i]));
  return { fields, ok: fields.every((x) => x.ok) };
}

export function gradeSteps(q, a) {
  const steps = (q.steps || []).map((s, i) => gradeStep(s, a?.steps?.[i]));
  const all = steps.flatMap((s) => s.fields);
  const right = all.filter((x) => x.ok).length;
  const score = all.length ? right / all.length : 0;
  return { correct: all.length > 0 && score >= STEPS_PASS - 1e-12, score, steps, right, total: all.length };
}

// ---- written (self-graded rubric) -----------------------------------------------------------------------

/** Rubric points needed to pass: `pass`, default ⌈0.6·n⌉. */
export function writtenPass(q) {
  const n = (q.rubric || []).length;
  return Number.isInteger(q.pass) ? Math.min(Math.max(q.pass, 0), n) : Math.ceil(0.6 * n);
}

export function gradeWritten(q, a) {
  const n = (q.rubric || []).length;
  const ticks = [...new Set((a?.ticks || []).filter((i) => Number.isInteger(i) && i >= 0 && i < n))].sort((x, y) => x - y);
  const need = writtenPass(q);
  return { correct: n > 0 && ticks.length >= need, score: n ? ticks.length / n : 0, ticks, right: ticks.length, total: n, need };
}

// ---- output (Python stdout) ----------------------------------------------------------------------------

const smartQuotes = (s) => s.replace(/[“”„″]/g, '"').replace(/[‘’′]/g, "'");

function dropBlankEdges(lines) {
  let a = 0;
  let b = lines.length;
  while (a < b && !lines[a].trim()) a++;
  while (b > a && !lines[b - 1].trim()) b--;
  return lines.slice(a, b);
}

/** The student's typed output as right-trimmed lines without blank lines at either end. */
export function outputLines(text) {
  return dropBlankEdges(smartQuotes(String(text ?? "")).replace(/\r\n?/g, "\n").split("\n").map((l) => l.replace(/\s+$/, "")));
}

/**
 * Canonical form of one stdout line (SPEC §3.4): edges trimmed, runs of whitespace → one space, and the
 * space after a comma normalised (`[2,3]` == `[2, 3]`). Everything else — brackets, dots, case — must match.
 */
export function normalizeOutLine(line) {
  return smartQuotes(String(line ?? "")).trim().replace(/\s+/g, " ").replace(/\s*,\s*/g, ", ").replace(/, $/, ",");
}

const same = (a, b) => a.length === b.length && a.every((x, i) => x === b[i]);

/** Compare typed output with the real stdout lines. Whitespace-only differences pass with a note. */
export function gradeOutput(text, expected) {
  const real = dropBlankEdges((expected || []).map((l) => String(l).replace(/\s+$/, "")));
  const mine = outputLines(text);
  if (same(mine, real)) return { correct: true, score: 1, lines: mine };
  const nm = mine.map(normalizeOutLine).filter((l, i, arr) => l !== "" || (i > 0 && i < arr.length - 1));
  const nr = real.map(normalizeOutLine).filter((l, i, arr) => l !== "" || (i > 0 && i < arr.length - 1));
  if (same(nm, nr)) return { correct: true, score: 1, note: SPACING_NOTE, lines: mine };
  return { correct: false, score: 0, lines: mine };
}

/** Line diff (LCS) of the student's lines vs the real output: `[{op: "same"|"mine"|"real", text}]`. */
export function diffLines(mine, real) {
  const key = (s) => normalizeOutLine(s);
  const n = mine.length;
  const m = real.length;
  const dp = Array.from({ length: n + 1 }, () => new Array(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i][j] = key(mine[i]) === key(real[j]) ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }
  const ops = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (key(mine[i]) === key(real[j])) {
      ops.push({ op: "same", text: real[j] });
      i++;
      j++;
    } else if (dp[i + 1][j] >= dp[i][j + 1]) {
      ops.push({ op: "mine", text: mine[i++] });
    } else {
      ops.push({ op: "real", text: real[j++] });
    }
  }
  while (i < n) ops.push({ op: "mine", text: mine[i++] });
  while (j < m) ops.push({ op: "real", text: real[j++] });
  return ops;
}

// ---- multi ----------------------------------------------------------------------------------------------

/** Multi-select with negative marking: (right − wrong) / #answers, floored at 0; correct only on the exact set. */
export function gradeMulti(q, a) {
  const answer = new Set(q.answer);
  if (a.skip) return { correct: false, score: 0, skipped: true, right: 0, wrong: 0, missed: answer.size };
  const picks = new Set(a.picks || []);
  let right = 0;
  let wrong = 0;
  for (const i of picks) (answer.has(i) ? right++ : wrong++);
  const missed = answer.size - right;
  const score = Math.max(0, (right - wrong) / answer.size);
  return { correct: wrong === 0 && missed === 0, score, right, wrong, missed };
}

// ---- dispatch -------------------------------------------------------------------------------------------

/** The answer key as a student answer (used by the QA preview). */
export function correctAnswer(q) {
  const str = (f) => String(f.answer);
  switch (q.type) {
    case "ox": return { value: q.answer };
    case "choice": return { index: q.answer };
    case "multi": return { picks: [...q.answer] };
    case "output": return { text: (q.answer || []).join("\n") };
    case "numeric": return { vals: (q.fields || []).map(str) };
    case "steps": return { steps: (q.steps || []).map((s) => (s.fields || []).map(str)), checked: (q.steps || []).length };
    case "written": return { text: "", revealed: true, ticks: (q.rubric || []).map((_, i) => i) };
    default: return {};
  }
}

/** Grade any question. */
export function grade(q, a) {
  if (!a || a.dontKnow) return { correct: false, score: 0, dontKnow: true };
  switch (q.type) {
    case "ox": {
      if (a.skip && typeof a.value !== "boolean") return { correct: false, score: 0, skipped: true };
      const correct = a.value === q.answer;
      return { correct, score: correct ? 1 : 0 };
    }
    case "choice": {
      const correct = a.index === q.answer;
      return { correct, score: correct ? 1 : 0 };
    }
    case "output": {
      const r = gradeOutput(a.text, q.answer);
      return r.correct ? r : { ...r, diff: diffLines(r.lines, q.answer || []) };
    }
    case "multi": return gradeMulti(q, a);
    case "numeric": return gradeNumeric(q, a);
    case "steps": return gradeSteps(q, a);
    case "written": return gradeWritten(q, a);
    default: return { correct: false, score: 0 };
  }
}

/** Is this a "PyTorch code" question for the mock's section 5? (`output`, or `choice`/`numeric` with code.) */
export function isCodeQuestion(q) {
  return q.type === "output" || ((q.type === "choice" || q.type === "numeric") && typeof q.code === "string" && q.code.trim() !== "");
}
