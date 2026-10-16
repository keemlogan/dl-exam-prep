// Question screen body, feedback body, concept card and easy primer — shared by adaptive study, retries,
// the QA preview and the mock exam.
import { openCalculator } from "./calc.js";
import { evalExpr, fieldTol, fmtNum, gradeNumeric, gradeStep, isAnswered, isPlainNumber, writtenPass } from "./grade.js";
import { codeHtml, codeLines, FORMAT_LABEL, LEVEL_LABEL, mdInline, mdLite, pct, refLabel, shortTitle, splitTermDefs, termDefsHtml } from "./render.js";
import { mentionedSlides } from "./slides.js";
import { refChip, slidesInline } from "./slideview.js";
import { h, icon } from "./ui.js";

export function conceptChip(concept) {
  const week = concept?.week ? `${concept.week}주차 · ` : "";
  return h("span", { class: "chip chip-concept" }, week + shortTitle(concept?.title_ko || ""));
}

/** Neutral badge for questions adapted from a source (`source`, e.g. "기출 변형"). */
export function sourceBadge(q) {
  return q.source ? h("span", { class: "chip chip-source" }, q.source) : null;
}

export function levelDots(level) {
  return h("span", { class: "level", role: "img", "aria-label": `난이도 ${LEVEL_LABEL[level] || ""} (${level}/3)` },
    [1, 2, 3].map((i) => h("i", { class: i <= level ? "on" : "" })),
    h("em", null, LEVEL_LABEL[level] || ""));
}

export function md(tag, cls, text) {
  return h(tag, { class: cls, html: mdLite(text) });
}

const mdi = (tag, cls, text) => h(tag, { class: cls, html: mdInline(text) });

const isTyping = (t) => t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA");
/** Choices that are program output / code: shown monospaced, without markdown. */
const checkKind = (q) => (typeof q.check === "string" ? q.check : q.check?.kind) || "none";
const monoChoice = (q, text) => String(text ?? "").includes("\n") || (q.type === "choice" && checkKind(q) === "output");

function choiceNode(q, text, cls) {
  const mono = monoChoice(q, text);
  return mono ? h("span", { class: `${cls} mono` }, String(text ?? "")) : h("span", { class: cls, html: mdInline(text) });
}

export const codeBlock = (code) => h("div", { class: "code-card", html: codeHtml(codeLines(code)) });

/** A program's stdout under the label "실행 결과". */
export function outputBlock({ label = "실행 결과", lines = [], message = null, legend = null }) {
  const body = message || h("pre", { class: "out-block" }, lines.length ? lines.join("\n") : "(출력 없음)");
  return h("div", { class: "outv" }, h("div", { class: "outv-head" }, h("span", { class: "fb-label" }, label), legend), body);
}

// ---- number fields ----------------------------------------------------------------------------------------

let fieldSeq = 0;

/** One labelled input for a numeric field; shows "= value" for expressions and a warning when unreadable. */
function numberField(f, value, { onInput, onKey, onFocus } = {}) {
  const id = `nf-${++fieldSeq}`;
  const input = h("input", { class: "num-in", id, type: "text", inputmode: "text", autocomplete: "off", autocapitalize: "off",
    autocorrect: "off", spellcheck: "false", enterkeyhint: "done", placeholder: "답", value: value ?? "" });
  const preview = h("span", { class: "num-preview", "aria-live": "polite" });
  const sync = () => {
    const s = input.value.trim();
    const v = evalExpr(s);
    preview.classList.remove("is-bad");
    if (!s || isPlainNumber(s)) preview.textContent = "";
    else if (Number.isFinite(v)) preview.textContent = `= ${fmtNum(v)}`;
    else { preview.textContent = "식을 읽을 수 없어요"; preview.classList.add("is-bad"); }
  };
  input.addEventListener("input", () => { sync(); onInput?.(input.value); });
  input.addEventListener("keydown", (e) => onKey?.(e, input));
  input.addEventListener("focus", () => onFocus?.(input));
  sync();
  const fix = h("span", { class: "num-fix" });
  const el = h("div", { class: "num-row" },
    h("label", { class: "num-label", for: id, html: mdInline(f.label || "답", { refs: false }) }),
    h("div", { class: "num-box" }, input, f.unit ? h("span", { class: "num-unit", html: mdInline(f.unit, { refs: false }) }) : null),
    preview, fix);
  return {
    el, input,
    valid: () => Number.isFinite(evalExpr(input.value)),
    mark(res) {
      input.readOnly = true;
      el.classList.add(res.ok ? "ok" : "bad");
      if (!res.ok) {
        const tol = res.tol ? ` (±${fmtNum(res.tol)})` : "";
        fix.replaceChildren(icon("alert", 14), h("span", null, `정답 ${fmtNum(res.answer)}${tol}`));
      } else fix.replaceChildren(icon("check", 14), h("span", null, "맞아요"));
    },
  };
}

// ---- question view ----------------------------------------------------------------------------------------

/**
 * Build a question. `order` = display order of choices (original indices); `answer` = restored draft;
 * `mode` = "learn" (one step at a time, model answers, checks) or "mock" (paper style: no help until the end).
 * Returns `{el, getAnswer, isAnswered, stage, handleKey, lock, focusFirst}`. `stage()` is non-null while the
 * question has an inner step before grading (steps: "1단계 확인", written: "모범 답안 보기").
 */
export function questionView(q, { concept, order, answer, hideKo = false, chips = [], mode = "learn", onChange, onToggleKo, onEnter }) {
  let ans = answer ? JSON.parse(JSON.stringify(answer)) : {};
  delete ans.dontKnow;
  const mock = mode === "mock";
  let locked = false;
  const changed = () => onChange?.(ans);
  const choiceOrder = order && order.length === (q.choices || []).length ? order : (q.choices || []).map((_, i) => i);

  const koToggle = h("button", { class: "ko-toggle", type: "button", "aria-pressed": String(hideKo),
    title: "시험지처럼 영어 문제만 볼 수 있어요" }, hideKo ? "한글 보기" : "한글 숨기기");
  koToggle.addEventListener("click", () => {
    hideKo = !hideKo;
    root.classList.toggle("hide-ko", hideKo);
    koToggle.setAttribute("aria-pressed", String(hideKo));
    koToggle.textContent = hideKo ? "한글 보기" : "한글 숨기기";
    onToggleKo?.(hideKo);
  });

  const fmt = FORMAT_LABEL[q.format] || FORMAT_LABEL.concept;
  const root = h("article", { class: `q q-${q.type}${hideKo ? " hide-ko" : ""}`, tabindex: "-1", "aria-label": "문제" },
    h("div", { class: "q-meta" },
      h("div", { class: "q-chips" }, conceptChip(concept), sourceBadge(q), chips, levelDots(q.level)),
      q.prompt_en ? koToggle : null),
    h("p", { class: "q-format" }, `${fmt.ko} · ${fmt.en}`),
    q.prompt_en ? md("h2", "q-en", q.prompt_en) : null,
    q.prompt_ko ? md(q.prompt_en ? "div" : "h2", q.prompt_en ? "q-ko ko" : "q-en", q.prompt_ko) : null,
    q.given ? md("div", "given md", q.given) : null,
    q.figure ? h("div", { class: "q-figure ez-pic", html: q.figure }) : null,
    q.code ? codeBlock(q.code) : null);

  if (q.type === "ox") {
    root.append(h("div", { class: "statement" },
      q.statement_en ? md("div", "st-en", q.statement_en) : null,
      q.statement_ko ? md("div", q.statement_en ? "st-ko ko" : "st-en", q.statement_ko) : null));
  }

  const area = h("div", { class: "answer" });
  root.append(area);
  let focusables = [];
  let setOx = null;
  let pickChoice = null;
  let toggleSkip = null;
  let choiceBtns = [];
  let stage = () => null;
  let viewAnswered = () => isAnswered(q, ans);
  let lockType = () => {};

  // ---- ox ----
  if (q.type === "ox") {
    const btns = [[true, "True", "참 · 맞는 설명"], [false, "False", "거짓 · 틀린 설명"]].map(([v, mark, label], i) => {
      const b = h("button", { class: "ox-btn", type: "button", role: "radio", "aria-checked": String(ans.value === v),
        "data-v": String(v) }, h("span", { class: "ox-mark", "aria-hidden": "true" }, mark),
        h("span", { class: "ox-label" }, label), h("kbd", { "aria-hidden": "true" }, String(i + 1)));
      b.addEventListener("click", () => setOx(v));
      return b;
    });
    area.append(h("div", { class: "ox", role: "radiogroup", "aria-label": "True 또는 False" }, btns));
    let skipBtn = null;
    if (mock) {
      area.prepend(h("p", { class: "tip" }, icon("alert", 18),
        h("span", null, "맞히면 +2, 틀리면 −2예요. 확실하지 않으면 비워 두세요(0점).")));
      skipBtn = h("button", { class: "choice is-skip ox-skip", type: "button", role: "radio", "aria-checked": String(!!ans.skip) },
        h("span", { class: "choice-no", "aria-hidden": "true" }),
        h("span", { class: "choice-tx" }, h("b", null, "비워두기"), h("small", null, "0점 · 감점 없음")),
        h("kbd", { "aria-hidden": "true" }, "0"));
      skipBtn.addEventListener("click", () => setOx(null));
      area.append(skipBtn);
    }
    focusables = [...btns, skipBtn].filter(Boolean);
    setOx = (v) => {
      if (v === null) {
        delete ans.value;
        ans.skip = true;
      } else {
        ans.value = v;
        delete ans.skip;
      }
      btns.forEach((b) => b.setAttribute("aria-checked", String(b.dataset.v === String(v))));
      skipBtn?.setAttribute("aria-checked", String(!!ans.skip));
      changed();
    };
    lockType = (result, given) => {
      root.querySelectorAll(".ox-btn").forEach((b) => {
        const v = b.dataset.v === "true";
        if (v === q.answer) b.classList.add("is-correct");
        else if (given.value === v) b.classList.add("is-wrong");
      });
      if (skipBtn) skipBtn.disabled = true;
    };
  }

  // ---- choice / multi ----
  if (q.type === "choice" || q.type === "multi") {
    const multi = q.type === "multi";
    if (multi) {
      area.append(h("p", { class: "tip" }, icon("alert", 18),
        h("span", null, "틀린 선택은 감점돼요. 확실한 것만 고르고, 모르겠으면 비워 두는 게 나아요.")));
    }
    const list = h("div", { class: "choices", role: multi ? "group" : "radiogroup", "aria-label": multi ? "해당하는 것 모두 선택" : "보기" });
    const btns = choiceOrder.map((orig, pos) => {
      const b = h("button", { class: `choice${multi ? " is-multi" : ""}`, type: "button", role: multi ? "checkbox" : "radio",
        "aria-checked": "false", "data-i": String(orig) },
      h("span", { class: "choice-no", "aria-hidden": "true" }, multi ? "" : String(pos + 1)),
      choiceNode(q, q.choices[orig], "choice-tx"),
      multi ? h("kbd", { "aria-hidden": "true" }, String(pos + 1)) : null);
      b.addEventListener("click", () => pickChoice(orig));
      return b;
    });
    list.append(...btns);
    let skipBtn = null;
    if (multi) {
      skipBtn = h("button", { class: "choice is-skip", type: "button", role: "checkbox", "aria-checked": "false" },
        h("span", { class: "choice-no", "aria-hidden": "true" }),
        h("span", { class: "choice-tx" }, h("b", null, "비워두기"), h("small", null, "0점 · 감점 없음")),
        h("kbd", { "aria-hidden": "true" }, "0"));
      skipBtn.addEventListener("click", () => toggleSkip());
      list.append(skipBtn);
    }
    area.append(list);
    focusables = [...btns, skipBtn].filter(Boolean);
    const sync = () => {
      const picks = new Set(ans.picks || []);
      btns.forEach((b) => {
        const i = Number(b.dataset.i);
        b.setAttribute("aria-checked", String(multi ? picks.has(i) : ans.index === i));
      });
      if (skipBtn) skipBtn.setAttribute("aria-checked", String(!!ans.skip));
    };
    pickChoice = (i) => {
      if (multi) {
        const picks = new Set(ans.picks || []);
        picks.has(i) ? picks.delete(i) : picks.add(i);
        ans.picks = [...picks].sort((a, b) => a - b);
        delete ans.skip;
      } else ans.index = i;
      sync();
      changed();
    };
    toggleSkip = () => {
      ans.skip = !ans.skip;
      if (ans.skip) ans.picks = [];
      sync();
      changed();
    };
    choiceBtns = btns;
    sync();
    lockType = (result, given) => {
      const answerSet = new Set(multi ? q.answer : [q.answer]);
      const picks = new Set(multi ? given.picks || [] : [given.index]);
      root.querySelectorAll(".choice[data-i]").forEach((b) => {
        const i = Number(b.dataset.i);
        if (answerSet.has(i)) b.classList.add(picks.has(i) ? "is-correct" : "is-missed");
        else if (picks.has(i)) b.classList.add("is-wrong");
      });
    };
  }

  // ---- calculator (numeric / steps) ----
  let lastField = null;
  const calcButton = (getFields) => {
    const b = h("button", { type: "button", class: "calc-btn" }, icon("calc", 18), "계산기");
    b.addEventListener("click", () => {
      const fields = getFields().filter((x) => !x.input.readOnly);
      const target = fields.find((x) => x.input === lastField) || fields.find((x) => !x.input.value.trim()) || fields[0];
      openCalculator({
        target: target?.input || null,
        label: target ? target.el.querySelector(".num-label")?.textContent : "",
        onInsert: (v) => {
          target.input.value = v;
          target.input.dispatchEvent(new Event("input"));
        },
      });
    });
    return b;
  };

  // ---- numeric ----
  if (q.type === "numeric") {
    ans.vals ||= (q.fields || []).map(() => "");
    const fields = (q.fields || []).map((f, i) => numberField(f, ans.vals[i], {
      onInput: (v) => { ans.vals[i] = v; changed(); },
      onFocus: (inp) => { lastField = inp; },
      onKey: (e) => {
        if (e.key !== "Enter") return;
        e.preventDefault();
        const empty = fields.find((x) => !x.input.value.trim());
        if (empty) empty.input.focus();
        else if (fields.every((x) => x.valid())) onEnter?.();
      },
    }));
    area.append(h("div", { class: "num-fields" }, fields.map((x) => x.el)),
      h("div", { class: "num-tools" }, calcButton(() => fields),
        h("span", { class: "hint" }, "식으로 써도 돼요: 1/3, 2^3, sqrt(2), exp(-1), ln(2) · Enter로 채점")));
    focusables = fields.map((x) => x.input);
    viewAnswered = () => fields.length > 0 && fields.every((x) => x.valid());
    if (mock) viewAnswered = () => isAnswered(q, ans);
    lockType = (result) => {
      (result?.fields || gradeNumeric(q, ans).fields).forEach((res, i) => fields[i]?.mark(res));
      root.querySelector(".num-tools")?.remove();
    };
  }

  // ---- steps ----
  if (q.type === "steps") {
    const steps = q.steps || [];
    ans.steps ||= steps.map((s) => (s.fields || []).map(() => ""));
    steps.forEach((s, k) => { ans.steps[k] ||= (s.fields || []).map(() => ""); });
    if (!Number.isInteger(ans.checked)) ans.checked = 0;
    const box = h("div", { class: "steps" });
    const tools = h("div", { class: "num-tools" });
    area.append(box, tools);
    let active = []; // fields of the step being answered

    const carry = (k) => {
      const prev = steps.slice(0, k).flatMap((s) => s.fields || []);
      if (!prev.length) return null;
      return h("p", { class: "carry" }, icon("check", 14), h("span", null, "앞 단계 정답으로 이어서 풀어요: "),
        prev.map((f, i) => h("span", { class: "carry-v", html: `${mdInline(f.label || "답", { refs: false })} = ${esc(fmtNum(Number(f.answer)))}${i < prev.length - 1 ? "," : ""}` })));
    };
    const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;");

    const stepCard = (s, k, state) => {
      // state: "done" | "active" | "later" | "paper" | "review"
      const head = h("div", { class: "step-head" }, h("span", { class: "step-no" }, String(k + 1)),
        h("b", { class: "step-title", html: mdInline(s.title_ko || `${k + 1}단계`, { refs: false }) }));
      if (state === "later") return h("section", { class: "step is-later", "aria-label": `${k + 1}단계 (앞 단계를 확인하면 열려요)` }, head,
        h("span", { class: "step-later" }, "앞 단계를 확인하면 열려요"));
      const card = h("section", { class: `step is-${state}` }, head,
        s.prompt_en ? md("div", "step-en", s.prompt_en) : null,
        s.prompt_ko ? md("div", "step-ko ko", s.prompt_ko) : null,
        state === "active" && !mock ? carry(k) : null);
      const fields = (s.fields || []).map((f, i) => numberField(f, ans.steps[k][i], {
        onInput: (v) => { ans.steps[k][i] = v; changed(); },
        onFocus: (inp) => { lastField = inp; },
        onKey: (e) => {
          if (e.key !== "Enter") return;
          e.preventDefault();
          const empty = fields.find((x) => !x.input.value.trim());
          if (empty) return empty.input.focus();
          if (state === "active" && fields.every((x) => x.valid())) checkStep();
          else if (state === "paper") {
            const next = box.querySelectorAll(".num-in");
            const at = [...next].indexOf(e.target);
            if (at >= 0 && at < next.length - 1) next[at + 1].focus();
            else onEnter?.();
          }
        },
      }));
      card.append(h("div", { class: "num-fields" }, fields.map((x) => x.el)));
      if (state === "done" || state === "review") {
        const res = gradeStep(s, ans.steps[k]);
        res.fields.forEach((r, i) => fields[i].mark(r));
        if (s.solution && !(state === "review" && mock)) { // the mock review shows solutions in the feedback below
          card.append(h("div", { class: `step-sol${res.ok ? " ok" : ""}` }, h("p", { class: "step-sol-title" }, `${k + 1}단계 풀이`),
            md("div", "md", s.solution)));
        }
      }
      if (state === "active") {
        const skip = h("button", { type: "button", class: "text-btn" }, "이 단계 모르겠어요 · 풀이 보기");
        skip.addEventListener("click", () => checkStep(true));
        card.append(h("div", { class: "step-actions" }, skip));
        active = fields;
      }
      if (state === "paper") active = active.concat(fields);
      return card;
    };

    const render = () => {
      active = [];
      const n = steps.length;
      const cards = steps.map((s, k) => {
        if (locked) return stepCard(s, k, "review");
        if (mock) return stepCard(s, k, "paper");
        if (k < ans.checked) return stepCard(s, k, "done");
        if (k === ans.checked) return stepCard(s, k, "active");
        return stepCard(s, k, "later");
      });
      box.replaceChildren(h("p", { class: "steps-progress" }, mock || locked ? `${n}단계 · 모든 칸을 채워요`
        : ans.checked >= n ? `${n}단계 모두 확인했어요 · 채점해 볼까요?` : `${ans.checked + 1} / ${n}단계`), ...cards);
      tools.replaceChildren(...(locked || (!mock && ans.checked >= n) ? [] : [calcButton(() => active),
        h("span", { class: "hint" }, mock ? "시험지처럼 모든 단계를 한 번에 풀어요" : "단계마다 확인하면 풀이가 열려요 · 식으로 써도 돼요")]));
    };

    function checkStep(skip = false) {
      if (mock || locked || ans.checked >= steps.length) return;
      if (!skip && !active.every((x) => x.valid())) {
        const bad = active.find((x) => !x.valid());
        bad?.input.focus();
        return;
      }
      ans.checked += 1;
      render();
      changed();
      box.querySelector(".step.is-active .num-in")?.focus({ preventScroll: true });
      const sol = [...box.querySelectorAll(".step.is-done")].pop();
      sol?.scrollIntoView?.({ block: "start", behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
    }

    render();
    focusables = active.map((x) => x.input);
    stage = () => (mock || locked || ans.checked >= steps.length ? null
      : { label: `${ans.checked + 1}단계 확인`, ready: active.length > 0 && active.every((x) => x.valid()), run: () => checkStep() });
    viewAnswered = () => (mock ? isAnswered(q, ans) : ans.checked >= steps.length);
    lockType = () => render();
  }

  // ---- written ----
  if (q.type === "written") {
    ans.ticks ||= [];
    const ta = h("textarea", { class: "out prose", id: `wr-${q.id}`, rows: "5", spellcheck: "true", autocomplete: "off",
      placeholder: mock ? "시험지에 쓰듯이 영어(또는 한국어)로 답을 써요" : "영어 또는 한국어로 짧게 써 보세요. 비워 두고 모범 답안을 봐도 돼요" });
    ta.value = ans.text || "";
    const grow = () => {
      ta.style.height = "auto";
      ta.style.height = `${Math.max(132, ta.scrollHeight + 2)}px`;
    };
    ta.addEventListener("input", () => { ans.text = ta.value; grow(); changed(); });
    ta.addEventListener("keydown", (e) => {
      if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        onEnter?.();
      }
    });
    const panel = h("div", { class: "wr-panel" });
    area.append(h("label", { class: "field-label", for: ta.id }, mock ? "답안" : "내 답안"), ta,
      h("p", { class: "hint" }, mock ? "채점은 다 풀고 나서 모범 답안을 보며 스스로 해요" : "다 쓰면 모범 답안을 보고, 내 답에 들어간 포인트를 체크해요 · ⌘ Enter"),
      panel);
    requestAnimationFrame(grow);
    focusables = [ta];

    const reveal = () => {
      ans.revealed = true;
      ta.readOnly = true;
      renderPanel();
      changed();
      panel.scrollIntoView?.({ block: "start", behavior: "smooth" });
    };
    const renderPanel = () => {
      if (!ans.revealed) return panel.replaceChildren();
      panel.replaceChildren(modelAnswer(q), rubricList(q, ans.ticks, {
        disabled: locked,
        onToggle: (i) => {
          const set = new Set(ans.ticks);
          set.has(i) ? set.delete(i) : set.add(i);
          ans.ticks = [...set].sort((a, b) => a - b);
          changed();
        },
      }));
    };
    renderPanel();
    if (ans.revealed) ta.readOnly = true;
    stage = () => (mock || locked || ans.revealed ? null : { label: "모범 답안 보기", ready: true, run: reveal });
    viewAnswered = () => (mock ? isAnswered(q, ans) : !!ans.revealed);
    lockType = () => { if (!mock) renderPanel(); }; // the mock review shows model + rubric in the feedback
  }

  // ---- output ----
  if (q.type === "output") {
    const ta = h("textarea", { class: "out", id: `out-${q.id}`, rows: "4", spellcheck: "false", autocomplete: "off",
      autocapitalize: "off", autocorrect: "off", placeholder: "print가 찍는 줄을 한 줄에 하나씩 적어 주세요" });
    ta.value = ans.text || "";
    const grow = () => {
      ta.style.height = "auto";
      ta.style.height = `${Math.max(120, ta.scrollHeight + 2)}px`;
    };
    ta.addEventListener("input", () => { ans.text = ta.value; grow(); changed(); });
    ta.addEventListener("keydown", (e) => {
      if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        onEnter?.();
      }
    });
    area.append(h("label", { class: "field-label", for: ta.id }, "실행 결과 (stdout)"), ta,
      h("p", { class: "hint" }, "줄 끝 공백·여러 칸 띄어쓰기·쉼표 뒤 공백은 신경 안 써도 돼요 · 줄바꿈 Enter · 채점 ⌘ Enter"));
    requestAnimationFrame(grow);
    focusables = [ta];
  }

  function handleKey(e) {
    if (isTyping(e.target) || e.metaKey || e.ctrlKey || e.altKey || locked) return false;
    const k = e.key.toLowerCase();
    if (q.type === "ox") {
      if (k === "1" || k === "t" || k === "o") { setOx(true); return true; }
      if (k === "2" || k === "f" || k === "x") { setOx(false); return true; }
      if (k === "0" && mock) { setOx(null); return true; }
    }
    if ((q.type === "choice" || q.type === "multi") && /^[0-9]$/.test(k)) {
      if (k === "0") {
        if (q.type === "multi") { toggleSkip(); return true; }
        return false;
      }
      const pos = Number(k) - 1;
      if (pos < choiceOrder.length) {
        pickChoice(choiceOrder[pos]);
        choiceBtns[pos].focus({ preventScroll: true });
        return true;
      }
    }
    return false;
  }

  /** Freeze the question and colour the student's answer after grading. */
  function lock(result, given = ans) {
    locked = true;
    ans = given ? JSON.parse(JSON.stringify(given)) : ans;
    if (q.type === "steps") ans.steps ||= (q.steps || []).map((s) => (s.fields || []).map(() => ""));
    if (q.type === "written") ans.ticks ||= [];
    root.classList.add("locked");
    root.querySelectorAll("button.choice, button.ox-btn").forEach((b) => { b.disabled = true; });
    lockType(result, ans);
    root.querySelectorAll("textarea, input").forEach((el) => { el.readOnly = true; });
  }

  /** Typing questions focus their first field; choice/True-False questions focus the question itself (no ring). */
  function focusFirst() {
    const typing = ["output", "numeric", "steps", "written"].includes(q.type);
    const first = q.type === "steps" ? root.querySelector(".step.is-active .num-in, .step.is-paper .num-in") : focusables[0];
    (typing && first ? first : root).focus({ preventScroll: true });
  }

  return { el: root, getAnswer: () => ans, isAnswered: () => viewAnswered(), stage: () => stage(), handleKey, lock, focusFirst };
}

/** The model answer (English first, Korean behind a toggle). */
function modelAnswer(q) {
  const ko = q.model_ko ? md("div", "wr-model-ko md", q.model_ko) : null;
  if (ko) ko.hidden = true;
  const t = q.model_ko ? h("button", { type: "button", class: "text-btn", "aria-expanded": "false" }, "한국어로 보기") : null;
  t?.addEventListener("click", () => {
    ko.hidden = !ko.hidden;
    t.setAttribute("aria-expanded", String(!ko.hidden));
    t.textContent = ko.hidden ? "한국어로 보기" : "한국어 접기";
  });
  return h("div", { class: "wr-model" }, h("div", { class: "wr-model-head" }, h("span", { class: "fb-label" }, "모범 답안 · Model answer"), t),
    md("div", "wr-model-en md", q.model_en), ko);
}

/** Rubric checkboxes (self-grading). */
export function rubricList(q, ticks, { disabled = false, onToggle } = {}) {
  const set = new Set(ticks || []);
  const need = writtenPass(q);
  const n = (q.rubric || []).length;
  const count = h("b", null, `${set.size} / ${n}`);
  const list = h("div", { class: "rubric", role: "group", "aria-label": "채점 포인트" }, (q.rubric || []).map((r, i) => {
    const b = h("button", { type: "button", class: "rub", role: "checkbox", "aria-checked": String(set.has(i)), disabled },
      h("span", { class: "rub-box", "aria-hidden": "true" }),
      h("span", { class: "rub-tx" }, mdi("span", "rub-ko", r.ko || r.en || ""), r.en && r.ko ? mdi("small", "rub-en", r.en) : null));
    b.addEventListener("click", () => {
      set.has(i) ? set.delete(i) : set.add(i);
      b.setAttribute("aria-checked", String(set.has(i)));
      count.textContent = `${set.size} / ${n}`;
      onToggle?.(i);
    });
    return b;
  }));
  return h("div", { class: "wr-rubric" },
    h("div", { class: "wr-rubric-head" }, h("span", { class: "fb-label" }, `내 답에 들어간 포인트를 체크해요 · ${need}개 이상이면 통과`), count),
    list);
}

/**
 * Should this Enter key press grade / move on? Yes outside form controls, and also on a focused choice or
 * True/False button once the question is answered (otherwise Enter just re-selects the focused option).
 */
export function enterSubmits(e, view) {
  if (e.key !== "Enter" || e.metaKey || e.ctrlKey || e.altKey) return false;
  const t = e.target;
  if (t.closest?.(".q .choice, .q .ox-btn")) return view.isAnswered() || t.closest(".q.locked") !== null;
  return !t.closest?.("button, a, input, textarea");
}

// ---- feedback -----------------------------------------------------------------------------------------

function headline(q, r) {
  if (r.correct && r.score < 1) return { tone: "ok", title: "좋아요, 통과예요", sub: `${r.right} / ${r.total} ${q.type === "written" ? "포인트" : "칸"} · ${pct(r.score)}` };
  if (r.correct) return { tone: "ok", title: "좋아요, 정답이에요", sub: r.note ? "답은 맞았어요. 띄어쓰기와 줄바꿈만 한 번 더 볼까요?" : null };
  if (r.dontKnow) return { tone: "bad", title: "괜찮아요. 같이 짚고 넘어가요", sub: "해설을 읽고 다음 문제에서 바로 써먹어 봐요." };
  if (r.skipped) return { tone: "mid", title: "비워 뒀어요 · 0점", sub: "감점은 없어요. 아래 정답을 확인해 봐요." };
  if (r.score > 0) return { tone: "mid", title: `부분 점수예요 · ${pct(r.score)}`, sub: r.total ? `${r.right} / ${r.total} ${q.type === "written" ? "포인트" : "칸"} 맞혔어요` : "조금만 더 정확하게 가 볼까요?" };
  return { tone: "bad", title: "아쉬워요. 이 부분만 다시 볼까요?", sub: null };
}

/** Field-by-field table for numeric / steps results. */
function fieldTable(fields, resFields, dontKnow) {
  return h("div", { class: "nf-table", role: "table" },
    h("div", { class: "nf-tr nf-th", role: "row" }, h("span", null, "항목"), h("span", null, "내 답"), h("span", null, "정답")),
    fields.map((f, i) => {
      const r = resFields?.[i];
      const given = r && r.given.trim() ? (isPlainNumber(r.given) || !Number.isFinite(r.value) ? r.given : `${r.given} = ${fmtNum(r.value)}`) : "–";
      const tol = fieldTol(f);
      return h("div", { class: `nf-tr ${r?.ok ? "ok" : "bad"}`, role: "row" },
        h("span", { class: "nf-label", html: mdInline(f.label || "답", { refs: false }) }),
        h("span", { class: "nf-mine mono" }, dontKnow ? "–" : given),
        h("span", { class: "nf-ans mono" }, fmtNum(Number(f.answer)), f.unit ? h("small", { html: ` ${mdInline(f.unit, { refs: false })}` }) : null,
          tol ? h("small", null, ` ±${fmtNum(tol)}`) : null));
    }));
}

function answerSection(q, a, r, order) {
  const sec = h("section", { class: "fb-answer" });
  const row = (label, content, cls = "") => h("div", { class: `fb-row ${cls}` }, h("span", { class: "fb-label" }, label), content);
  if (q.type === "ox") {
    sec.append(row("정답", h("b", null, q.answer ? "True · 맞는 설명이에요" : "False · 틀린 설명이에요")));
    if (!r.correct && typeof a.value === "boolean") sec.append(row("내 답", h("span", null, a.value ? "True" : "False"), "mine"));
  }
  if (q.type === "choice") {
    sec.append(row("정답", choiceNode(q, q.choices[q.answer], "fb-choice")));
    if (!r.correct && Number.isInteger(a.index)) sec.append(row("내 답", choiceNode(q, q.choices[a.index], "fb-choice"), "mine"));
  }
  // what the question's code really printed (the verifier ran it), for choice / numeric / ox with code
  if (q.type !== "output" && q.code && Array.isArray(q.observed) && q.observed.length) sec.append(outputBlock({ lines: q.observed }));
  if (q.type === "output") {
    if (r.correct || r.dontKnow || !r.diff) {
      sec.append(outputBlock({ label: "실행 결과", lines: q.answer || [] }));
    } else {
      sec.append(outputBlock({
        label: "내 답과 실행 결과 비교",
        legend: h("span", { class: "diff-legend" }, h("i", { class: "lg-mine" }, "−"), "내 답", h("i", { class: "lg-real" }, "+"), "실제"),
        message: h("div", { class: "diff", role: "table", "aria-label": "줄별 비교" }, r.diff.map((d) =>
          h("div", { class: `d d-${d.op}`, role: "row" },
            h("span", { class: "d-sign", "aria-label": d.op === "mine" ? "내 답에만 있음" : d.op === "real" ? "실제 출력에만 있음" : "같음" },
              d.op === "mine" ? "−" : d.op === "real" ? "+" : ""),
            h("span", { class: "d-tx" }, d.text || " ")))),
      }));
    }
  }
  if (q.type === "multi") {
    const answerSet = new Set(q.answer);
    const picks = new Set(a.picks || []);
    sec.append(h("ul", { class: "fb-multi" }, (order || q.choices.map((_, i) => i)).map((i) => {
      const inAns = answerSet.has(i);
      const picked = picks.has(i);
      let cls = "";
      let tag = "";
      if (inAns && picked) { cls = "ok"; tag = "+1"; }
      else if (!inAns && picked) { cls = "bad"; tag = "−1 감점"; }
      else if (inAns) { cls = "miss"; tag = "정답인데 안 골랐어요"; }
      return h("li", { class: cls }, choiceNode(q, q.choices[i], "fb-multi-tx"), tag ? h("em", null, tag) : null);
    })));
    if (!r.dontKnow) {
      const formula = r.skipped ? "비워두기 → 0점"
        : `맞힌 선택 ${r.right} − 틀린 선택 ${r.wrong} = ${r.right - r.wrong} → ${r.right - r.wrong} / 정답 ${answerSet.size}개 = ${pct(r.score)}`;
      sec.append(h("p", { class: "fb-formula" }, formula));
    }
  }
  if (q.type === "numeric") {
    sec.append(fieldTable(q.fields || [], r.fields, r.dontKnow));
  }
  if (q.type === "steps") {
    (q.steps || []).forEach((s, k) => {
      const rs = r.steps?.[k];
      const ok = rs?.ok && !r.dontKnow;
      sec.append(h("div", { class: `fb-step ${ok ? "ok" : "bad"}` },
        h("p", { class: "fb-step-title" }, h("span", { class: "step-no" }, String(k + 1)), h("b", { html: mdInline(s.title_ko || `${k + 1}단계`, { refs: false }) })),
        fieldTable(s.fields || [], rs?.fields, r.dontKnow),
        s.solution ? h("details", { class: "fb-sol", open: !ok || null }, h("summary", null, `${k + 1}단계 풀이`), md("div", "md", s.solution)) : null));
    });
    if (!r.dontKnow) sec.append(h("p", { class: "fb-formula" }, `맞힌 칸 ${r.right} / ${r.total} = ${pct(r.score)} · 75% 이상이면 통과`));
  }
  if (q.type === "written") {
    if (a.text?.trim()) sec.append(h("div", { class: "wr-mine" }, h("span", { class: "fb-label" }, "내 답안"), h("p", null, a.text)));
    sec.append(modelAnswer(q), rubricList(q, r.ticks || a.ticks || [], { disabled: true }));
    if (!r.dontKnow) sec.append(h("p", { class: "fb-formula" }, `체크한 포인트 ${r.right ?? 0} / ${r.total ?? (q.rubric || []).length} · 통과 기준 ${writtenPass(q)}개`));
  }
  return sec;
}

/** Explanation: leading term definitions in a "먼저 알아둘 용어" box, then the rest as markdown-lite. */
export function explanationView(text) {
  const { defs, rest } = splitTermDefs(text);
  return [defs.length ? h("div", { html: termDefsHtml(defs) }).firstChild : null, rest ? md("div", "md", rest) : null];
}

/**
 * Feedback body: headline, correct answer (diff for output, table for numbers), explanation with the slides it
 * cites, ref chip, "개념 카드 보기", mastery change. `mastery` = `{title, before, after, hint}` or null (mock review).
 */
export function feedbackView(q, a, r, { order, mastery, concept, onCard } = {}) {
  const hd = headline(q, r);
  const cardBtn = concept?.card && onCard ? h("button", { type: "button", class: "ref-chip is-button" }, icon("list", 16), h("span", null, "개념 카드 보기")) : null;
  cardBtn?.addEventListener("click", () => onCard(concept));
  const el = h("div", { class: `fb fb-${hd.tone}` },
    h("div", { class: "fb-head" },
      h("span", { class: "fb-icon" }, icon(hd.tone === "ok" ? "check" : hd.tone === "mid" ? "minus" : "alert", 26)),
      h("div", null, h("h2", { id: `fb-title-${q.id}` }, hd.title), hd.sub ? h("p", { class: "fb-sub" }, hd.sub) : null)),
    r.note ? h("p", { class: "note-chip" }, icon("alert", 16), r.note) : null,
    answerSection(q, a || {}, r, order),
    h("section", { class: "fb-explain" }, h("h3", null, "해설"), explanationView(q.explanation),
      slidesInline(mentionedSlides(q.explanation, q.ref))),
    h("div", { class: "fb-ref" }, refChip(q.ref), cardBtn));
  if (mastery) {
    const trend = mastery.after > mastery.before ? "up" : mastery.after < mastery.before ? "down" : "same";
    const bar = h("div", { class: "meter" }, h("i", { class: "meter-was", style: `width:${pct(mastery.before)}` }),
      h("i", { class: `meter-now ${trend === "down" ? "down" : ""}`, style: `width:${pct(mastery.before)}` }));
    el.append(h("div", { class: "fb-mastery" },
      h("div", { class: "fb-mastery-top" }, h("span", null, `‘${mastery.title}’ 숙련도`),
        h("b", null, `${pct(mastery.before)} → `, h("span", { class: trend }, pct(mastery.after)))),
      bar,
      mastery.hint ? h("p", { class: "meter-hint" }, mastery.hint) : null));
    requestAnimationFrame(() => requestAnimationFrame(() => { bar.lastChild.style.width = pct(mastery.after); }));
  }
  return el;
}

// ---- 쉬운 설명 (easy primer, read before practising) ------------------------------------------------------

/** `concept.easy`: hook → terms → pictures → worked example → code with line notes → 3 things → self-check. */
export function easyView(concept) {
  const ez = concept?.easy;
  if (!ez) return null;
  const ex = ez.example;
  return h("div", { class: "ez" },
    ez.hook ? md("p", "ez-hook", ez.hook) : null,
    ez.terms?.length ? h("div", { class: "ez-block" },
      h("p", { class: "ez-label" }, "먼저 알아둘 용어"),
      h("dl", { class: "ez-terms" }, ez.terms.map(([term, def]) => [h("dt", { html: mdInline(term, { refs: false }) }), md("dd", "md", def)]))) : null,
    (ez.scenes || []).map((s) => h("figure", { class: "ez-scene" },
      s.pic ? h("div", { class: "ez-pic", html: s.pic }) : null,
      s.say ? md("figcaption", "md", s.say) : null)),
    ex?.steps?.length ? h("div", { class: "ez-block ez-example" },
      h("p", { class: "ez-label" }, icon("calc", 18), ex.title || "숫자로 한 번 해 보기"),
      h("ol", { class: "ez-steps" }, ex.steps.map((s) => md("li", "md", s)))) : null,
    ez.code ? h("div", { class: "ez-block" },
      h("p", { class: "ez-label" }, "진짜 코드로 보기"),
      codeBlock(ez.code),
      ez.output?.length ? h("div", { class: "ccard-out" }, outputBlock({ lines: ez.output })) : null,
      ez.walk?.length ? h("ol", { class: "ez-walk" }, ez.walk.map(([lines, say]) =>
        h("li", null, h("span", { class: "ez-ln" }, `${lines}줄`), md("span", "md", say)))) : null) : null,
    ez.remember?.length ? h("div", { class: "ez-remember" },
      h("p", { class: "ez-label" }, icon("check", 18), `딱 ${ez.remember.length}개만 기억해요`),
      h("ul", null, ez.remember.map((r) => md("li", "", r)))) : null,
    ez.check?.length ? h("div", { class: "ez-block" },
      h("p", { class: "ez-label" }, "스스로 확인"),
      ez.check.map((c, i) => h("div", { class: "ez-q" },
        md("div", "ez-q-text", `**Q${i + 1}.** ${c.q}`),
        c.code ? codeBlock(c.code) : null,
        h("details", null, h("summary", null, "정답 보기"),
          c.output?.length ? outputBlock({ lines: c.output }) : null,
          md("div", "ez-q-ans", c.a))))) : null);
}

// ---- concept card -------------------------------------------------------------------------------------

export function cardView(concept) {
  const card = concept?.card;
  if (!card) {
    return h("div", { class: "ccard" },
      h("p", { class: "ccard-summary" }, "이 개념의 요약 카드는 아직 준비 중이에요. 방금 본 해설을 한 번 더 읽고, 쉬운 문제부터 다시 가 볼게요."),
      h("div", { class: "fb-ref" }, refChip(concept?.ref)));
  }
  const formula = (tex) => (/\$/.test(tex) ? tex : `$$${tex}$$`);
  return h("div", { class: "ccard" },
    md("div", "ccard-summary md", card.summary),
    card.points?.length ? h("ul", { class: "ccard-points" }, card.points.map((p) => md("li", "", p))) : null,
    card.formulas?.length ? h("div", { class: "ccard-formulas" }, h("p", { class: "ccard-label" }, "공식"),
      card.formulas.map(([tex, say]) => h("div", { class: "formula" }, md("div", "formula-tex", formula(tex)), say ? md("div", "formula-say", say) : null))) : null,
    card.code ? codeBlock(card.code) : null,
    card.output?.length ? h("div", { class: "ccard-out" }, outputBlock({ lines: card.output })) : null,
    card.pitfalls?.length ? h("div", { class: "ccard-pit" }, h("p", { class: "ccard-pit-title" }, icon("alert", 18), "시험에서 자주 틀려요"),
      h("ul", null, card.pitfalls.map((p) => md("li", "", p)))) : null,
    h("div", { class: "fb-ref" }, refChip(concept.ref, card.lecture || refLabel(concept.ref))));
}

// Shared arrowhead for `.ez-arrow` lines in pictures (CSS: marker-end: url(#ez-ah)).
if (typeof document !== "undefined" && !document.getElementById("ez-defs")) {
  const defs = document.createElement("div");
  defs.id = "ez-defs";
  defs.setAttribute("aria-hidden", "true");
  defs.style.cssText = "position:absolute;width:0;height:0;overflow:hidden";
  defs.innerHTML = '<svg width="0" height="0"><defs><marker id="ez-ah" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" ' +
    'markerHeight="7" orient="auto-start-reverse"><path class="ez-arrow-head ez-ah-head" d="M0,0 L10,5 L0,10 z"/></marker></defs></svg>';
  document.body.append(defs);
}
