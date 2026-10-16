// 실전 모의고사 (SPEC §5): 23 questions like the paper — 10 True/False (+2 / −2, 비워두기 0, section ≥ 0),
// 1 step-by-step calculation (20), 3 short calculations (5 each), 4 written answers (5 each, self-graded on the
// results screen), 5 PyTorch code questions (5 each, all-or-nothing) = 100 points in 120 minutes. The clock keeps
// running across reloads; no feedback until the end.
// Saved as `S.mock = {items, orders, answers, idx, startedAt, endsAt, submitted?, self?, done, results?, total?, max?,
// sections?, finishedAt?}`; `self[qid]` = rubric ticks the student gave their own written answers.
import { buildMock, MOCK_MINUTES, MOCK_PLAN, mockPoints, mockTotals, recordAnswer } from "./engine.js";
import { choiceOrder, grade, isAnswered } from "./grade.js";
import { enterSubmits, feedbackView, md, questionView, rubricList } from "./question.js";
import { pct, shortTitle } from "./render.js";
import { btn, h, icon, iconBtn, openSheet, shell, toast } from "./ui.js";

const LIMIT_MS = MOCK_MINUTES * 60 * 1000;
export const SECTIONS = [
  { key: "tf", no: 1, label: "True / False", short: "T/F", ko: "참/거짓", note: "틀리면 −2 · 비워두기 0" },
  { key: "steps", no: 2, label: "단계별 계산", short: "단계", ko: "Step-by-step calculation", note: "칸마다 부분 점수" },
  { key: "calc", no: 3, label: "짧은 계산", short: "계산", ko: "Short calculations", note: "칸마다 부분 점수" },
  { key: "written", no: 4, label: "서술형", short: "서술", ko: "Written answers", note: "끝나고 스스로 채점" },
  { key: "code", no: 5, label: "PyTorch 코드", short: "코드", ko: "PyTorch code", note: "맞으면 5점, 아니면 0점" },
];
const secOf = (key) => SECTIONS.find((s) => s.key === key) || { label: key, short: key, no: 0 };

const fmt = (x) => String(Math.round(x * 100) / 100);
const clock = (ms) => {
  const s = Math.max(0, Math.ceil(ms / 1000));
  const hh = Math.floor(s / 3600);
  const mm = String(Math.floor((s % 3600) / 60)).padStart(2, "0");
  const ss = String(s % 60).padStart(2, "0");
  return hh ? `${hh}:${mm}:${ss}` : `${mm}:${ss}`;
};

export function renderMock(ctx) {
  const m = ctx.S.mock;
  if (m) m.items = m.items.filter((it) => ctx.B.bank.byId.has(it.qid)); // the bank may have changed
  if (!m || !m.items.length) return intro(ctx);
  if (m.done) return results(ctx);
  if (m.submitted) return selfGrade(ctx);
  return running(ctx);
}

function intro(ctx) {
  const { B, S } = ctx;
  S.mock = null;
  const preview = buildMock(S.engine, B.bank);
  const count = (key) => preview.filter((i) => i.section === key).length;
  const start = () => {
    const items = buildMock(S.engine, B.bank);
    if (!items.length) return toast("아직 모의고사를 만들 문제가 부족해요");
    const now = Date.now();
    S.mock = { items, orders: Object.fromEntries(items.map((i) => [i.qid, choiceOrder(B.bank.byId.get(i.qid))])),
      answers: {}, self: {}, idx: 0, startedAt: now, endsAt: now + LIMIT_MS, done: false };
    ctx.persist(true);
    running(ctx);
  };
  const total = MOCK_PLAN.reduce((a, s) => a + s.n * s.pts, 0);
  const n = MOCK_PLAN.reduce((a, s) => a + s.n, 0);
  ctx.mount(shell({
    cls: "is-sub",
    top: [iconBtn("back", "처음으로", { href: "#/" })],
    content: [
      h("p", { class: "eyebrow" }, `${MOCK_MINUTES}분 · ${total}점 · ${n}문제`),
      h("h1", { class: "title" }, "실전처럼 한 번 풀어 볼까요?"),
      h("p", { class: "sub" }, "교수님 공지(참/거짓 감점, 서술형, 단계별 계산, PyTorch 코드)대로 구성했어요. 채점은 다 풀고 나서 한 번에 해요."),
      h("div", { class: "card plan" }, MOCK_PLAN.map((p) => {
        const sec = secOf(p.section);
        const have = count(p.section);
        return h("div", { class: "plan-row" }, h("b", null, `${sec.no}. ${sec.label}`), h("span", null, `${p.n}문제 · ${p.n * p.pts}점`),
          h("em", null, p.n > 1 ? `문제당 ${fmt(p.pts)}점 · ${sec.note}` : sec.note),
          have < p.n ? h("small", null, `지금은 ${have}문제만 준비돼 있어요`) : null);
      })),
      h("ul", { class: "rules" },
        h("li", null, `제한 시간은 ${MOCK_MINUTES}분이에요. 페이지를 닫아도 시간은 계속 흘러요.`),
        h("li", null, "계산기를 쓸 수 있어요(시험장에서도 공학용 계산기 허용). 계산 문제의 계산기 버튼을 눌러요."),
        h("li", null, "참/거짓은 틀리면 2점이 깎여요. 모르면 비워 두세요. 이 영역 점수는 0점 아래로 내려가지 않아요."),
        h("li", null, "서술형은 제출한 뒤 모범 답안을 보며 스스로 채점해요."),
        h("li", null, "푼 결과는 추천 학습에도 반영돼요.")),
    ],
    cta: btn("시작하기", { onClick: start }),
  }), { onKey: (e) => { if (e.key === "Enter" && !e.target.closest?.("button, a")) { e.preventDefault(); start(); } } });
}

function running(ctx) {
  const { B, S } = ctx;
  const m = S.mock;
  if (Date.now() >= m.endsAt) return finish(ctx, true);
  m.idx = Math.min(Math.max(0, m.idx || 0), m.items.length - 1);
  const item = m.items[m.idx];
  const q = B.bank.byId.get(item.qid);
  const sec = secOf(item.section);

  const timer = h("span", { class: "timer", role: "timer", "aria-label": "남은 시간" }, icon("clock", 18), h("b", null, clock(m.endsAt - Date.now())));
  const tick = () => {
    const left = m.endsAt - Date.now();
    timer.lastChild.textContent = clock(left);
    timer.classList.toggle("is-low", left < 10 * 60 * 1000);
    if (left <= 0) finish(ctx, true);
  };
  const interval = setInterval(tick, 1000);

  const dotFor = (it, i) => {
    const qq = B.bank.byId.get(it.qid);
    const done = isAnswered(qq, m.answers[it.qid]);
    const d = h("button", { type: "button", class: `qdot${i === m.idx ? " is-current" : ""}${done ? " is-done" : ""}`,
      "aria-label": `${i + 1}번 문제 (${secOf(it.section).label})${done ? " 답함" : ""}`, "aria-current": i === m.idx ? "step" : null }, String(i + 1));
    d.addEventListener("click", () => goTo(i));
    return d;
  };
  const dotEls = m.items.map(dotFor);
  const dots = h("nav", { class: "qnav", "aria-label": "문제 이동" }, SECTIONS.map((s) => {
    const idx = m.items.map((it, i) => (it.section === s.key ? i : -1)).filter((i) => i >= 0);
    if (!idx.length) return null;
    return h("div", { class: "qgroup" }, h("span", { class: "qgroup-label" }, `${s.no} ${s.short}`), idx.map((i) => dotEls[i]));
  }));

  const view = questionView(q, {
    concept: ctx.concept(q.concept), order: m.orders[q.id], answer: m.answers[q.id], hideKo: S.prefs.hideKo, mode: "mock",
    chips: [h("span", { class: "chip chip-orange" }, `${sec.no}. ${sec.label} · ${fmt(item.pts)}점`)],
    onChange: (a) => {
      m.answers[q.id] = a;
      dotEls[m.idx].classList.toggle("is-done", isAnswered(q, a));
      ctx.persist();
    },
    onToggleKo: (v) => { S.prefs.hideKo = v; ctx.persist(); },
    onEnter: () => next(),
  });

  const last = m.idx === m.items.length - 1;
  const goTo = (i) => {
    m.idx = i;
    ctx.persist();
    running(ctx);
  };
  const next = () => (last ? submit(ctx) : goTo(m.idx + 1));

  ctx.mount(shell({
    top: [iconBtn("close", "나가기 (시간은 계속 흘러요)", { href: "#/" }),
      h("span", { class: "topbar-title" }, `${m.idx + 1} / ${m.items.length}`), timer],
    content: [dots, view.el],
    cta: [btn("이전", { kind: "secondary", cls: "is-narrow", disabled: m.idx === 0, onClick: () => goTo(m.idx - 1) }),
      btn(last ? "제출하기" : "다음", { onClick: next })],
  }), {
    teardown: () => clearInterval(interval),
    onKey(e) {
      if (view.handleKey(e)) return e.preventDefault();
      if (enterSubmits(e, view)) {
        e.preventDefault();
        next();
      }
    },
  });
  view.focusFirst();
}

function submit(ctx) {
  const { B, S } = ctx;
  const m = S.mock;
  const left = m.items.filter((it) => !isAnswered(B.bank.byId.get(it.qid), m.answers[it.qid])).length;
  if (!left) return finish(ctx, false);
  const sheet = openSheet(h("div", { class: "sheet-body" },
    h("h2", { class: "sheet-title" }, `아직 안 푼 문제가 ${left}개 있어요`),
    h("p", { class: "sub" }, "안 푼 문제는 0점이에요(참/거짓은 비워 둔 것과 같아요). 그래도 제출할까요?"),
    h("div", { class: "sheet-cta two" },
      btn("계속 풀기", { kind: "secondary", onClick: () => sheet.close("cancel") }),
      btn("제출하기", { onClick: () => { sheet.close("next"); finish(ctx, false); } }))), { label: "제출 확인" });
}

const writtenToGrade = (ctx) => ctx.S.mock.items.filter((it) => {
  const q = ctx.B.bank.byId.get(it.qid);
  return it.section === "written" && q.type === "written" && isAnswered(q, ctx.S.mock.answers[it.qid]);
});

/** Time is up or the student submitted: stop the clock; written answers are self-graded next. */
function finish(ctx, timedOut) {
  const m = ctx.S.mock;
  if (m.done) return results(ctx);
  if (!m.submitted) {
    m.submitted = true;
    m.finishedAt = Math.min(Date.now(), m.endsAt);
    m.self ||= {};
    ctx.persist(true);
    if (timedOut) toast("시간이 다 됐어요. 자동으로 제출했어요");
  }
  if (writtenToGrade(ctx).length) return selfGrade(ctx);
  complete(ctx);
}

/** 서술형 스스로 채점: model answer + rubric next to each written answer, before the total is shown. */
function selfGrade(ctx) {
  const { B, S } = ctx;
  const m = S.mock;
  m.self ||= {};
  const list = writtenToGrade(ctx);
  if (!list.length) return complete(ctx);
  const cards = list.map((it, k) => {
    const q = B.bank.byId.get(it.qid);
    const a = m.answers[it.qid] || {};
    return h("section", { class: "card selfgrade" },
      h("p", { class: "eyebrow" }, `서술형 ${k + 1} / ${list.length} · ${fmt(it.pts)}점`),
      md("h2", "q-en", q.prompt_en),
      q.prompt_ko ? md("div", "q-ko", q.prompt_ko) : null,
      h("div", { class: "wr-mine" }, h("span", { class: "fb-label" }, "내 답안"), h("p", null, a.text || "")),
      h("div", { class: "wr-panel" }, modelBox(q), rubricList(q, m.self[it.qid] || [], {
        onToggle: (i) => {
          const set = new Set(m.self[it.qid] || []);
          set.has(i) ? set.delete(i) : set.add(i);
          m.self[it.qid] = [...set].sort((x, y) => x - y);
          ctx.persist();
        },
      })));
  });
  ctx.mount(shell({
    cls: "is-sub",
    top: [iconBtn("back", "처음으로", { href: "#/" }), h("span", { class: "topbar-title" }, "서술형 스스로 채점")],
    content: [
      h("p", { class: "eyebrow" }, "제출했어요 · 마지막 한 단계"),
      h("h1", { class: "title" }, "서술형은 직접 채점해요"),
      h("p", { class: "sub" }, "모범 답안을 읽고, 내 답에 실제로 들어간 포인트만 체크해요. 너그럽게 체크하면 실전에서 손해예요."),
      cards,
    ],
    cta: btn("채점 끝내고 점수 보기", { onClick: () => complete(ctx) }),
  }));
}

function modelBox(q) {
  const ko = q.model_ko ? md("div", "wr-model-ko md", q.model_ko) : null;
  return h("div", { class: "wr-model" }, h("div", { class: "wr-model-head" }, h("span", { class: "fb-label" }, "모범 답안 · Model answer")),
    md("div", "wr-model-en md", q.model_en), ko ? h("details", { class: "wr-ko" }, h("summary", null, "한국어로 보기"), ko) : null);
}

/** Grade everything, record it for the adaptive engine, and show the results. */
function complete(ctx) {
  const { B, S } = ctx;
  const m = S.mock;
  if (m.done) return results(ctx);
  const t = Date.now();
  const byQid = {};
  m.results = m.items.map((it) => {
    const q = B.bank.byId.get(it.qid);
    let a = m.answers[it.qid];
    if (q.type === "written" && a) a = { ...a, revealed: true, ticks: m.self?.[it.qid] || [] };
    const answered = isAnswered(q, a);
    const r = answered ? grade(q, a) : { correct: false, score: 0, unanswered: true };
    if (answered && !r.skipped) recordAnswer(S.engine, q, r, { mode: "mock", t, ms: 0 }, B.bank);
    byQid[it.qid] = r;
    return { qid: it.qid, r, pts: mockPoints(it, r) };
  });
  const totals = mockTotals(m.items, byQid);
  m.total = totals.total;
  m.max = totals.max;
  m.sections = totals.sections;
  m.done = true;
  ctx.persist(true);
  results(ctx);
}

function results(ctx) {
  const { B, S } = ctx;
  const m = S.mock;
  const ratio = m.max ? m.total / m.max : 0;
  const message = ratio >= 0.9 ? "이대로면 충분해요. 실수만 조심해요."
    : ratio >= 0.7 ? "거의 다 왔어요. 아래 약한 개념만 한 번 더 볼까요?"
    : "약한 개념부터 하나씩 채워 봐요. 아래에서 바로 연습할 수 있어요.";
  const byQid = new Map((m.results || []).map((x) => [x.qid, x]));
  const items = m.items.filter((it) => byQid.has(it.qid)); // the bank may have dropped a question since
  const totals = mockTotals(items, Object.fromEntries([...byQid].map(([k, v]) => [k, v.r])));

  const bySection = SECTIONS.map((s) => {
    const row = totals.sections[s.key];
    if (!row) return null;
    const penalty = s.key === "tf" && row.raw < 0 ? h("small", null, ` · 감점 ${fmt(row.raw)} → 0점 처리`) : null;
    return h("div", { class: "sec-row" },
      h("div", { class: "sec-top" }, h("span", null, `${s.no}. ${s.label}`, h("small", null, ` · ${s.note}`), penalty),
        h("b", null, `${fmt(row.got)} / ${fmt(row.max)}점`)),
      h("div", { class: "meter" }, h("i", { class: "meter-now", style: `width:${row.max ? (row.got / row.max) * 100 : 0}%` })));
  });

  // per-concept: points kept (a T/F penalty counts as 0 for the concept) over points possible
  const per = new Map();
  for (const it of items) {
    const q = B.bank.byId.get(it.qid);
    const row = per.get(q.concept) || { got: 0, max: 0, n: 0 };
    row.got += Math.max(0, byQid.get(it.qid).pts);
    row.max += it.pts;
    row.n += 1;
    per.set(q.concept, row);
  }
  const weak = [...per].map(([cid, r]) => ({ cid, ...r, ratio: r.max ? r.got / r.max : 0 }))
    .filter((r) => r.ratio < 0.6).sort((a, b) => a.ratio - b.ratio || b.max - a.max).slice(0, 8);
  const weakList = weak.length ? h("div", { class: "card flush" }, h("ul", { class: "weak-list" }, weak.map((w) => {
    const c = ctx.concept(w.cid);
    return h("li", null, h("a", { class: "weak-row", href: `#/practice/${encodeURIComponent(w.cid)}` },
      h("span", { class: "weak-tx" }, h("b", null, shortTitle(c?.title_ko || w.cid)),
        h("span", null, `${fmt(w.got)} / ${fmt(w.max)}점 · ${w.n}문제 · ${pct(w.ratio)}`)),
      h("span", { class: "weak-go" }, "이 개념 연습하기", icon("next", 16))));
  }))) : h("p", { class: "empty card" }, "60% 아래로 떨어진 개념이 없어요. 잘했어요.");

  const review = h("ol", { class: "review" }, items.map((it, i) => {
    const q = B.bank.byId.get(it.qid);
    const { r, pts } = byQid.get(it.qid);
    const state = r.unanswered || r.skipped ? "skip" : r.correct && pts >= it.pts ? "ok" : pts > 0 ? "mid" : "bad";
    const label = { ok: "정답", mid: "부분 점수", bad: pts < 0 ? "오답 · 감점" : "오답", skip: r.skipped ? "비워둠" : "안 풂" }[state];
    const row = h("button", { type: "button", class: `review-row is-${state}` },
      h("span", { class: "review-no" }, String(i + 1)),
      h("span", { class: "review-tx" }, h("b", null, shortTitle(ctx.concept(q.concept)?.title_ko)),
        h("span", null, `${secOf(it.section).label} · ${label}`)),
      h("span", { class: "review-pts" }, `${fmt(pts)} / ${fmt(it.pts)}`),
      icon("next", 18));
    row.addEventListener("click", () => openReview(ctx, it, q, r));
    return h("li", null, row);
  }));

  const used = (m.finishedAt || Date.now()) - m.startedAt;
  ctx.mount(shell({
    cls: "is-sub",
    top: [iconBtn("back", "처음으로", { href: "#/" }), h("span", { class: "topbar-title" }, "모의고사 결과")],
    content: [
      h("p", { class: "eyebrow" }, `푼 시간 ${clock(used)} / ${clock(LIMIT_MS)}`),
      h("h1", { class: "score" }, h("strong", null, fmt(totals.total)), h("span", null, ` / ${fmt(totals.max)}점`)),
      h("p", { class: "sub" }, message),
      h("div", { class: "card" }, bySection),
      h("h2", { class: "section-title" }, "약한 개념", h("small", null, "60% 미만 · 낮은 순")),
      weakList,
      h("h2", { class: "section-title" }, "문제별로 다시 보기"),
      h("div", { class: "card flush" }, review),
    ],
    cta: [btn("오답 다시 풀기", { kind: "secondary", cls: "is-narrow", href: "#/retry" }),
      btn("새 모의고사", { onClick: () => { S.mock = null; ctx.persist(true); intro(ctx); } })],
  }));
}

function openReview(ctx, item, q, r) {
  const m = ctx.S.mock;
  let a = m.answers[q.id] || {};
  if (q.type === "written") a = { ...a, revealed: true, ticks: m.self?.[q.id] || [] };
  const view = questionView(q, { concept: ctx.concept(q.concept), order: m.orders[q.id], answer: a, hideKo: ctx.S.prefs.hideKo, mode: "mock",
    chips: [h("span", { class: "chip chip-orange" }, `${fmt(item.pts)}점`)] });
  view.lock(r, a);
  const close = btn("닫기", { onClick: () => sheet.close("next") });
  const sheet = openSheet(h("div", { class: "sheet-body" }, view.el,
    r.unanswered ? h("p", { class: "note-chip" }, icon("alert", 16), "이 문제는 풀지 않았어요") : null,
    feedbackView(q, a, r.unanswered ? { correct: false, score: 0, dontKnow: true } : r,
      { order: m.orders[q.id], concept: ctx.concept(q.concept) }),
    h("div", { class: "sheet-cta" }, close)), { label: "문제 다시 보기", className: "review-sheet" });
}
