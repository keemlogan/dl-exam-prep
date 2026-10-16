import { ROOT } from "../common/api.js";
// Written-test trainer (SPA). Routes:
//   #/            mode picker          #/learn        추천 학습 (adaptive)
//   #/concepts    개념 골라서          #/concept/:id  concept card + history
//   #/practice/:id 이 개념만 연습      #/retry[/:qid] 오답 다시 풀기
//   #/wrong       오답노트             #/stats        내 학습 현황
//   #/mock        실전 모의고사       #/preview/:qid  QA: answered-correctly view, nothing is saved
//   #/guide       시험 분석 (data/guide.json)
//
// Saved progress (store.js): {engine, session, mock, prefs}. `session` is the question on screen:
//   {kind: "learn"|"practice"|"retry", cid?, queue?, idx?, right?, qid, reason, order, draft,
//    phase: "question"|"feedback"|"celebrate"|"card"|"done", answer, result, events, mastery, shownAt}
// so a reload lands on the same question, answer draft, or feedback sheet.
import { dDay } from "../common/api.js";
import { l3Needed, masteryHint, masteryOf, MOCK_MINUTES, MOCK_PLAN, nextQuestion, peekConcept, recordAnswer, summarize, wrongList } from "./engine.js";
import { choiceOrder, correctAnswer, grade } from "./grade.js";
import { renderGuide } from "./guide.js";
import { renderMock } from "./mock.js";
import { cardView, enterSubmits, feedbackView, questionView } from "./question.js";
import { pct, shortTitle } from "./render.js";
import { renderConceptDetail, renderConcepts, renderStats, renderWrong } from "./stats.js";
import { DEV, loadBank, loadSaved, save } from "./store.js";
import { btn, closeAllSheets, h, icon, iconBtn, openSheet, progressBar, shell, topSheet, trapTab } from "./ui.js";

const app = document.getElementById("app");

/** Shared with stats.js and mock.js. */
const ctx = {
  B: null, // {bundle, bank}
  S: null, // saved progress
  keyHandler: null,
  teardown: null,
  prevHash: "",
  readOnly: false, // set by #/preview: nothing is written until the page reloads
  dirty: false,
  persist(immediate = false) {
    if (ctx.readOnly) return;
    save(ctx.S, { immediate });
    ctx.dirty = !immediate;
  },
  go(hash) {
    if (location.hash === hash) router();
    else location.hash = hash;
  },
  mount(el, { onKey = null, teardown = null } = {}) {
    ctx.teardown?.();
    closeAllSheets();
    ctx.keyHandler = onKey;
    ctx.teardown = teardown;
    app.replaceChildren(el);
    window.scrollTo(0, 0);
  },
  concept(cid) {
    return ctx.B.bank.conceptById[cid];
  },
};

// ---- mode picker --------------------------------------------------------------------------------------

function renderModes() {
  const { B, S } = ctx;
  const sum = summarize(S.engine, B.bank.concepts, B.bank);
  const d = dDay();
  const wrongN = wrongList(S.engine).filter((w) => B.bank.byId.has(w.qid)).length;
  const focus = S.engine.focus && ctx.concept(S.engine.focus.cid);
  const resumable = S.session?.kind === "learn" && S.session.qid;
  const mockRunning = S.mock && !S.mock.done;
  const mockN = MOCK_PLAN.reduce((a, s) => a + s.n, 0);
  const mockPts = MOCK_PLAN.reduce((a, s) => a + s.n * s.pts, 0);

  const mode = (ic, title, desc, href, extra = null, cls = "") =>
    h("a", { class: `mode ${cls}`, href }, h("span", { class: "mode-ic" }, icon(ic)),
      h("span", { class: "mode-tx" }, h("b", null, title, extra), h("span", null, desc)), icon("next", 20));

  const meter = progressBar(sum.overall, "", "전체 숙련도");
  const content = [
    h("p", { class: "eyebrow" }, d > 0 ? `시험까지 D-${d}` : d === 0 ? "오늘이 시험이에요" : "시험이 끝났어요"),
    h("h1", { class: "title" }, "딥러닝 문제 연습"),
    h("p", { class: "sub" }, "영어 시험 문제를 한 문제씩 풀고 바로 채점해요. 약한 개념은 쉬운 문제부터, 아는 개념은 가끔 복습만 나와요."),
    h("a", { class: "card summary-card", href: "#/stats" },
      h("div", { class: "summary-top" },
        h("div", null, h("span", { class: "label" }, "전체 숙련도"), h("strong", { class: "big" }, pct(sum.overall))),
        h("div", { class: "summary-side" }, h("span", null, `완료 ${sum.mastered}/${sum.total}`),
          h("span", null, sum.answered ? `푼 문제 ${sum.answered} · 정답률 ${pct(sum.accuracy)}` : "아직 푼 문제가 없어요"))),
      meter.el,
      h("span", { class: "card-link" }, "내 학습 현황 보기", icon("next", 18))),
    h("h2", { class: "section-title" }, "어떻게 공부할까요?"),
    h("div", { class: "modes" },
      mode("guide", "시험 분석", "기출과 올해 공지로 본 출제 유형 · 꼭 볼 개념", "#/guide"),
      mode("target", "추천 학습", focus ? `지금 ‘${shortTitle(focus.title_ko)}’ 연습 중이에요` : "약한 개념부터 쉬운 문제로 시작해요",
        "#/learn", h("span", { class: "chip chip-blue" }, "추천"), "is-main"),
      mode("list", "개념 골라서", `${B.bank.concepts.length}개 개념 중 하나만 집중해서 풀어요`, "#/concepts"),
      mode("retry", "오답 다시 풀기", wrongN ? `틀린 문제 ${wrongN}개를 다시 풀어요` : "아직 틀린 문제가 없어요", "#/retry"),
      mode("exam", "실전 모의고사", mockRunning ? "진행 중이에요 · 이어서 풀기" : `${mockN}문제 · ${MOCK_MINUTES}분 · ${mockPts}점 만점 · 끝나고 채점`, "#/mock",
        mockRunning ? h("span", { class: "chip chip-orange" }, "진행 중") : null)),
    h("div", { class: "links" },
      h("a", { href: "#/wrong" }, icon("retry", 18), "오답노트"),
      h("a", { href: "#/stats" }, icon("chart", 18), "내 학습 현황")),
    DEV ? h("p", { class: "dev-note" }, "개발용 문제 은행(web/written/dev)을 쓰고 있어요. 진행 기록은 이 브라우저에만 저장돼요.") : null,
  ];
  ctx.mount(shell({
    cls: "is-sub",
    top: [iconBtn("back", "홈으로", { href: "/" })],
    content,
    cta: btn(resumable ? "이어서 풀기" : "추천 학습 시작하기", { href: "#/learn" }),
  }));
}

// ---- study sessions (learn / practice / retry) --------------------------------------------------------

function newSession(kind, arg) {
  const { B, S } = ctx;
  const ses = { kind, cid: kind === "practice" ? arg : null, qid: null, phase: "question" };
  if (kind === "retry") {
    ses.only = arg || null;
    ses.queue = arg ? [arg] : wrongList(S.engine).map((w) => w.qid).filter((id) => B.bank.byId.has(id)).slice(0, 20);
    ses.idx = 0;
    ses.right = 0;
  }
  S.session = ses;
  return ses;
}

function renderSession(kind, arg = "") {
  const { B, S } = ctx;
  if (kind === "practice" && !B.bank.conceptById[arg]) return ctx.go("#/concepts");
  let ses = S.session;
  const same = ses && ses.kind === kind && (kind !== "practice" || ses.cid === arg) &&
    (kind !== "retry" || (ses.only || "") === arg);
  if (!same) ses = newSession(kind, arg);
  if (ses.phase === "celebrate") return showCelebrate(ses);
  if (ses.phase === "card") return showCard(ses);
  if (ses.phase === "done") return showRetryDone(ses);
  const q = ses.qid && B.bank.byId.get(ses.qid);
  if (q) return showQuestion(ses, q);
  if (kind === "retry") {
    if (!ses.queue.length) return showRetryDone(ses);
    return prepare(ses, B.bank.byId.get(ses.queue[ses.idx]));
  }
  return advance(ses);
}

/** Pick and show the next question for learn/practice. */
function advance(ses) {
  const { B, S } = ctx;
  if (ses.kind === "retry") {
    ses.idx += 1;
    while (ses.idx < ses.queue.length && !B.bank.byId.has(ses.queue[ses.idx])) ses.idx += 1;
    if (ses.idx >= ses.queue.length) {
      ses.phase = "done";
      ctx.persist(true);
      return showRetryDone(ses);
    }
    return prepare(ses, B.bank.byId.get(ses.queue[ses.idx]));
  }
  const pick = nextQuestion(S.engine, B.bank, { only: ses.cid, exclude: ses.qid ? [ses.qid] : [] });
  if (!pick) return showEmpty();
  ses.reason = pick.reason;
  return prepare(ses, pick.q);
}

function prepare(ses, q) {
  Object.assign(ses, { qid: q.id, order: choiceOrder(q), draft: null, answer: null, result: null, events: null,
    mastery: null, phase: "question", shownAt: Date.now() });
  ctx.persist();
  showQuestion(ses, q);
}

/** After the feedback sheet: celebration, then concept card, then the next question. */
function proceed(ses, from = "feedback") {
  const ev = ses.events || {};
  if (from === "feedback" && ev.mastered) {
    ses.phase = "celebrate";
    ctx.persist();
    return showCelebrate(ses);
  }
  if (from !== "card" && ev.showCard) {
    ses.phase = "card";
    ctx.persist();
    return showCard(ses);
  }
  advance(ses);
}

function sessionTop(ses) {
  const { B, S } = ctx;
  const bar = progressBar(0, "", ses.kind === "learn" ? "전체 숙련도" : ses.kind === "practice" ? "개념 숙련도" : "오답 진행");
  const update = () => {
    if (ses.kind === "learn") {
      const sum = summarize(S.engine, B.bank.concepts, B.bank);
      bar.set(sum.overall, `완료 ${sum.mastered}/${sum.total}`);
    } else if (ses.kind === "practice") {
      const m = masteryOf(S.engine, ses.cid, B.bank);
      bar.set(m, `숙련도 ${pct(m)}`);
    } else {
      const total = ses.queue.length || 1;
      bar.set((ses.idx + (ses.phase === "question" ? 0 : 1)) / total, `${Math.min(ses.idx + 1, total)} / ${total}`);
    }
  };
  update();
  const back = ses.kind === "practice" ? `#/concept/${encodeURIComponent(ses.cid)}` : ses.kind === "retry" ? "#/wrong" : "#/";
  return { el: [iconBtn("close", "그만하기", { href: back }), bar.el], update };
}

function showQuestion(ses, q) {
  const { B, S } = ctx;
  const concept = ctx.concept(q.concept) || { title_ko: q.concept };
  const cs = peekConcept(S.engine, q.concept);
  const chips = [];
  if (ses.reason === "review") chips.push(h("span", { class: "chip chip-green" }, "복습"));
  if (ses.reason === "extra") chips.push(h("span", { class: "chip chip-green" }, "추가 복습"));
  if (ses.phase === "question" && cs.n === 0) chips.push(h("span", { class: "chip chip-blue" }, "새 개념"));

  const top = sessionTop(ses);
  const gradeBtn = btn("채점하기", { onClick: () => primary() });
  const dkBtn = btn("모르겠어요", { kind: "secondary", cls: "is-narrow", onClick: () => doGrade(true) });
  const nextBtn = btn("다음 문제", { onClick: () => proceed(ses) });
  const reopenBtn = btn("해설 보기", { kind: "secondary", cls: "is-narrow", onClick: () => openFeedback() });
  const ctaIn = h("div", { class: "cta-in" });
  const setCta = () => ctaIn.replaceChildren(...(ses.phase === "feedback" ? [reopenBtn, nextBtn] : [dkBtn, gradeBtn]));

  const view = questionView(q, {
    concept, chips, order: ses.order, hideKo: S.prefs.hideKo,
    answer: ses.phase === "feedback" ? ses.answer : ses.draft,
    onChange: (a) => {
      ses.draft = a;
      syncGrade();
      ctx.persist();
    },
    onToggleKo: (v) => {
      S.prefs.hideKo = v;
      ctx.persist();
    },
    onEnter: () => primary(),
  });
  syncGrade();
  setCta();

  /** The main button: an inner stage first (steps: "n단계 확인", written: "모범 답안 보기"), then 채점하기. */
  function syncGrade() {
    const st = view.stage();
    gradeBtn.textContent = st ? st.label : "채점하기";
    gradeBtn.disabled = st ? !st.ready : !view.isAnswered();
  }
  function primary() {
    if (ses.phase !== "question") return;
    const st = view.stage();
    if (st) {
      if (st.ready) st.run();
      syncGrade();
      return;
    }
    doGrade(false);
  }

  function doGrade(dontKnow) {
    if (ses.phase !== "question") return;
    if (!dontKnow && !view.isAnswered()) return;
    // 모르겠어요 keeps what was typed so far for typing questions (shown next to the answer key)
    const keep = ["numeric", "steps", "written", "output"].includes(q.type);
    const answer = dontKnow ? { ...(keep ? view.getAnswer() : {}), dontKnow: true } : view.getAnswer();
    const result = grade(q, answer);
    const mBefore = masteryOf(S.engine, q.concept, B.bank);
    const events = recordAnswer(S.engine, q, result, { mode: ses.kind, t: Date.now(), ms: Date.now() - (ses.shownAt || Date.now()) }, B.bank);
    Object.assign(ses, { answer, result, events, phase: "feedback", draft: null,
      mastery: { before: mBefore, after: masteryOf(S.engine, q.concept, B.bank),
        hint: masteryHint(S.engine.concepts[q.concept], l3Needed(B.bank, q.concept)) } });
    if (ses.kind === "retry" && result.correct) ses.right += 1;
    ctx.persist(true);
    view.lock(result, answer);
    setCta();
    top.update();
    openFeedback();
  }

  function openFeedback() {
    const body = feedbackView(q, ses.answer, ses.result, {
      order: ses.order, concept, mastery: ses.mastery && { title: shortTitle(concept.title_ko), ...ses.mastery }, onCard: openCardSheet,
    });
    const go = btn("다음 문제", { onClick: () => proceed(ses) });
    const tone = ses.result.correct ? "ok" : ses.result.score > 0 || ses.result.skipped ? "mid" : "bad";
    openSheet(h("div", { class: "sheet-body" }, body, h("div", { class: "sheet-cta" }, go)), {
      label: "채점 결과", className: `fb-sheet tone-${tone}`,
      onClose: (reason) => { if (reason === "esc" || reason === "scrim") nextBtn.focus({ preventScroll: true }); },
    });
  }

  ctx.mount(shell({ top: top.el, content: [view.el], cta: ctaIn }), {
    onKey(e) {
      if (view.handleKey(e)) {
        e.preventDefault();
        return;
      }
      if (enterSubmits(e, view)) {
        e.preventDefault();
        if (ses.phase === "question") primary();
        else proceed(ses);
      }
    },
  });
  if (ses.phase === "feedback") {
    view.lock(ses.result, ses.answer);
    openFeedback();
  } else {
    view.focusFirst();
  }
}

/** 개념 카드 as a sheet on top of the feedback (the "개념 카드 보기" button). */
export function openCardSheet(concept) {
  const sheet = openSheet(h("div", { class: "sheet-body" },
    h("p", { class: "eyebrow" }, `${concept.week ? `${concept.week}주차 · ` : ""}개념 카드`),
    h("h2", { class: "sheet-title" }, concept.title_ko),
    cardView(concept),
    h("div", { class: "sheet-cta" }, btn("닫기", { onClick: () => sheet.close("button") }))), { label: "개념 카드", className: "card-sheet" });
  return sheet;
}

function showCelebrate(ses) {
  const { B, S } = ctx;
  const q = B.bank.byId.get(ses.qid);
  const concept = ctx.concept(q?.concept) || {};
  const cs = peekConcept(S.engine, concept.id);
  const sum = summarize(S.engine, B.bank.concepts, B.bank);
  const meter = progressBar(sum.mastered / (sum.total || 1), `완료 ${sum.mastered}/${sum.total}`, "완료한 개념");
  const learn = ses.kind === "learn";
  const go = () => proceed(ses, "celebrate");
  ctx.mount(shell({
    cls: "is-center",
    content: [
      h("div", { class: "celebrate", "aria-hidden": "true" }, h("span", { class: "burst" }, icon("check", 40)),
        ...[1, 2, 3, 4, 5, 6].map((i) => h("i", { class: `spark s${i}` }))),
      h("h1", { class: "title", role: "status" }, `‘${shortTitle(concept.title_ko)}’ 완료!`),
      h("p", { class: "sub" }, learn ? "확실히 알고 있어요. 다음 개념으로 갈게요. 이 개념은 가끔 복습으로만 나와요."
        : "확실히 알고 있어요. 이제 이 개념은 가끔 복습으로만 나와요."),
      h("div", { class: "stat-row" },
        h("div", null, h("span", null, "푼 문제"), h("b", null, String(cs.n))),
        h("div", null, h("span", null, "정답률"), h("b", null, pct(cs.n ? cs.correct / cs.n : 0))),
        h("div", null, h("span", null, "숙련도"), h("b", null, pct(masteryOf(S.engine, concept.id, B.bank))))),
      meter.el,
    ],
    cta: btn(learn ? "다음 개념으로" : "계속하기", { onClick: go }),
  }), { onKey: (e) => { if (e.key === "Enter" && !e.repeat && !e.target.closest?.("button, a")) { e.preventDefault(); go(); } } });
}

function showCard(ses) {
  const { B } = ctx;
  const q = B.bank.byId.get(ses.qid);
  const concept = ctx.concept(q?.concept) || {};
  const go = () => proceed(ses, "card");
  ctx.mount(shell({
    top: [iconBtn("close", "그만하기", { href: "#/" })],
    content: [
      h("p", { class: "eyebrow" }, `${shortTitle(concept.title_ko)} · 두 번 연속 틀렸어요`),
      h("h1", { class: "title" }, "잠깐, 개념 한 번 짚고 갈게요"),
      h("p", { class: "sub" }, "핵심만 보고, 쉬운 문제부터 다시 올라가요."),
      cardView(concept),
    ],
    cta: btn("이해했어요, 계속할게요", { onClick: go }),
  }), { onKey: (e) => { if (e.key === "Enter" && !e.repeat && !e.target.closest?.("button, a")) { e.preventDefault(); go(); } } });
}

function showRetryDone(ses) {
  const n = ses.queue.length;
  const content = n
    ? [h("div", { class: "celebrate", "aria-hidden": "true" }, h("span", { class: "burst" }, icon("retry", 36))),
      h("h1", { class: "title" }, `오답 ${n}개 중 ${ses.right}개를 맞혔어요`),
      h("p", { class: "sub" }, ses.right === n ? "전부 고쳤어요. 이제 추천 학습으로 넘어가 볼까요?" : "다시 틀린 문제는 오답노트에 남아 있어요. 조금 뒤에 한 번 더 봐요.")]
    : [h("h1", { class: "title" }, "다시 풀 오답이 없어요"), h("p", { class: "sub" }, "틀린 문제가 생기면 여기서 모아서 다시 풀 수 있어요.")];
  ctx.S.session = null; // the next visit to #/retry starts from the current 오답 list
  ctx.persist();
  ctx.mount(shell({
    cls: "is-center", content,
    cta: [btn("오답노트", { kind: "secondary", cls: "is-narrow", href: "#/wrong" }), btn("추천 학습으로", { href: "#/learn" })],
  }));
}

function showEmpty() {
  ctx.mount(shell({
    cls: "is-center",
    content: [h("h1", { class: "title" }, "아직 문제가 없어요"), h("p", { class: "sub" }, "문제 은행을 만드는 중이에요. 잠시 뒤에 다시 열어 주세요.")],
    cta: btn("처음으로", { href: "#/" }),
  }));
}

// ---- QA preview ---------------------------------------------------------------------------------------

/** #/preview/<qid>: the question answered correctly with its feedback sheet open. Saving is off for this page. */
function renderPreview(qid) {
  const { B } = ctx;
  ctx.readOnly = true;
  const list = B.bank.questions;
  const q = B.bank.byId.get(qid);
  if (!q) {
    return ctx.mount(shell({
      cls: "is-center",
      content: [h("h1", { class: "title" }, "그런 문제가 없어요"), h("p", { class: "sub" }, `id: ${qid || "(비어 있음)"}`)],
      cta: list.length ? btn("첫 문제 미리보기", { href: `#/preview/${encodeURIComponent(list[0].id)}` }) : null,
    }));
  }
  const at = list.indexOf(q);
  const hrefOf = (x) => `#/preview/${encodeURIComponent(x.id)}`;
  const prevQ = list[(at - 1 + list.length) % list.length];
  const nextQ = list[(at + 1) % list.length];
  const concept = ctx.concept(q.concept) || { title_ko: q.concept };
  const answer = correctAnswer(q);
  const result = grade(q, answer);
  const order = (q.choices || []).map((_, i) => i);
  const view = questionView(q, { concept, order, answer, hideKo: false, mode: "learn",
    chips: [h("span", { class: "chip chip-orange" }, "미리보기 · 저장 안 함")] });
  view.lock(result, answer);
  const open = () => openSheet(h("div", { class: "sheet-body" },
    feedbackView(q, answer, result, { order, concept, onCard: openCardSheet }),
    h("div", { class: "sheet-cta" }, btn("이전", { kind: "secondary", cls: "is-narrow", href: hrefOf(prevQ) }),
      btn("다음 문제", { href: hrefOf(nextQ) }))), { label: "채점 결과 미리보기", className: "fb-sheet tone-ok" });
  ctx.mount(shell({
    top: [iconBtn("close", "미리보기 끝내기", { onClick: () => { location.href = ROOT+"written/" + location.search; } }),
      h("span", { class: "topbar-title" }, `${at + 1} / ${list.length} · ${q.id}`)],
    content: [view.el],
    cta: [btn("해설 보기", { kind: "secondary", cls: "is-narrow", onClick: open }), btn("다음 문제", { href: hrefOf(nextQ) })],
  }));
  open();
}

// ---- boot ---------------------------------------------------------------------------------------------

function router() {
  const m = (location.hash || "#/").match(/^#\/?([^/]*)\/?(.*)$/) || [];
  const route = m[1] || "";
  const arg = decodeURIComponent(m[2] || "");
  if (ctx.readOnly && route !== "preview") return location.reload(); // leave preview with fresh, writable state
  switch (route) {
    case "preview": return renderPreview(arg);
    case "learn": return renderSession("learn");
    case "practice": return renderSession("practice", arg);
    case "retry": return renderSession("retry", arg);
    case "concepts": return renderConcepts(ctx);
    case "concept": return renderConceptDetail(ctx, arg);
    case "stats": return renderStats(ctx);
    case "wrong": return renderWrong(ctx);
    case "mock": return renderMock(ctx);
    case "guide": return renderGuide(ctx);
    default: return renderModes();
  }
}

document.addEventListener("keydown", (e) => {
  if (trapTab(e)) return;
  const sheet = topSheet();
  if (sheet) {
    if (e.key === "Escape" && sheet.dismissible) {
      e.preventDefault();
      sheet.close("esc");
    } else if (e.key === "Enter" && !e.repeat && !e.target.closest?.("button, a, input, textarea")) {
      const primary = sheet.el.querySelector(".sheet-cta .btn-primary:not(:disabled)");
      if (primary) {
        e.preventDefault();
        primary.click();
      }
    }
    return;
  }
  if (e.repeat && e.key === "Enter") return;
  ctx.keyHandler?.(e);
});

async function boot() {
  try {
    ctx.B = await loadBank(); // first: a fallback to the dev bundle also switches progress to this browser only
    ctx.S = await loadSaved();
  } catch (err) {
    app.replaceChildren(shell({
      cls: "is-center",
      content: [h("h1", { class: "title" }, "문제를 불러오지 못했어요"),
        h("p", { class: "sub" }, "서버가 켜져 있는지 확인해 주세요. (시작하기.command를 더블클릭)"),
        h("p", { class: "dev-note" }, String(err.message || err))],
      cta: btn("다시 시도", { onClick: () => location.reload() }),
    }));
    return;
  }
  window.addEventListener("hashchange", (e) => {
    ctx.prevHash = new URL(e.oldURL).hash;
    router();
  });
  // flush pending changes only: an idle tab must not write its (possibly stale) copy over another tab's progress
  const flush = () => { if (ctx.dirty) ctx.persist(true); };
  window.addEventListener("pagehide", flush);
  document.addEventListener("visibilitychange", () => { if (document.visibilityState === "hidden") flush(); });
  router();
}

boot();
