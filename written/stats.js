// 내 학습 현황 (dashboard), 개념 목록/상세, 오답노트 — all derived from the engine state and answer history.
import { accuracyBy, conceptStatus, l3Needed, masteryHint, masteryOf, peekConcept, rollingAccuracy, summarize, wrongList } from "./engine.js";
import { cardView, conceptChip, easyView, levelDots, sourceBadge } from "./question.js";
import { FORMAT_LABEL, LEVEL_LABEL, mdInline, pct, STATUS_LABEL, shortTitle, TYPE_LABEL, WEEKS } from "./render.js";
import { btn, h, icon, iconBtn, shell, timeAgo } from "./ui.js";

const STATUS_CHIP = { mastered: "chip-green", learning: "chip-blue", new: "" };

function meter(value, status = "learning", label = "") {
  return h("div", { class: `meter is-${status}`, role: "img", "aria-label": label || `숙련도 ${pct(value)}` },
    h("i", { class: "meter-now", style: `width:${pct(value)}` }));
}

function backTop(href) {
  return [iconBtn("back", "뒤로", { href })];
}

/** Concepts grouped by week (1–7) with a mastery bar and status chip; each row links to the concept page. */
function conceptGroups(ctx) {
  const { B, S } = ctx;
  const weeks = [...new Set(B.bank.concepts.map((c) => c.week))].sort((a, b) => (a ?? 99) - (b ?? 99));
  return weeks.map((week) => {
    const list = B.bank.concepts.filter((c) => c.week === week);
    const name = week ? `${week}주차` : "기타";
    const desc = WEEKS[week] || "";
    if (!list.length) return null;
    const done = list.filter((c) => S.engine.concepts[c.id]?.status === "mastered").length;
    return h("section", { class: "group" },
      h("div", { class: "group-head" }, h("h2", { class: "section-title" }, name, h("small", null, desc)),
        h("span", { class: "group-count" }, `${done}/${list.length} 완료`)),
      h("div", { class: "card flush" }, list.map((c) => {
        const cs = S.engine.concepts[c.id];
        const st = conceptStatus(cs);
        const m = masteryOf(S.engine, c.id, B.bank);
        const count = (B.bank.byConcept[c.id] || []).length;
        return h("a", { class: "crow", href: `#/concept/${encodeURIComponent(c.id)}` },
          h("span", { class: "crow-main" },
            h("span", { class: "crow-title" }, shortTitle(c.title_ko), h("span", { class: `chip ${STATUS_CHIP[st]}` }, STATUS_LABEL[st]),
              c.easy ? h("span", { class: "chip chip-orange" }, "쉬운 설명") : null),
            h("span", { class: "crow-sub" }, count ? `${c.ref} · ${count}문제` : `${c.ref} · 문제 준비 중`)),
          h("span", { class: "crow-meter" }, meter(m, st, `${shortTitle(c.title_ko)} 숙련도 ${pct(m)}`), h("b", null, pct(m))),
          icon("next", 18));
      })));
  });
}

// ---- dashboard ----------------------------------------------------------------------------------------

export function renderStats(ctx) {
  const { B, S } = ctx;
  const sum = summarize(S.engine, B.bank.concepts, B.bank);
  const hist = S.engine.history;
  const byFormat = accuracyBy(hist, "format");
  const formats = ["tf", "calc", "written", "code", "concept"].filter((f) => f !== "concept" || byFormat.concept);
  const byType = accuracyBy(hist, "type");
  const chartBox = h("div", { class: "chart" });

  ctx.mount(shell({
    cls: "is-sub",
    top: backTop("#/"),
    content: [
      h("h1", { class: "title" }, "내 학습 현황"),
      h("div", { class: "hero" }, h("span", { class: "label" }, "전체 숙련도"), h("strong", { class: "hero-num" }, pct(sum.overall)),
        meter(sum.overall, "learning", `전체 숙련도 ${pct(sum.overall)}`)),
      h("div", { class: "tiles" },
        h("div", { class: "tile" }, h("span", null, "완료한 개념"), h("b", null, `${sum.mastered}`, h("small", null, ` / ${sum.total}`))),
        h("div", { class: "tile" }, h("span", null, "푼 문제"), h("b", null, String(sum.answered))),
        h("div", { class: "tile" }, h("span", null, "정답률"), h("b", null, sum.accuracy == null ? "–" : pct(sum.accuracy)))),
      h("section", { class: "card" },
        h("h2", { class: "card-title" }, "최근 50문제 정답률"),
        h("p", { class: "card-sub" }, "문제마다 직전 10문제의 정답률이에요"),
        chartBox),
      h("section", { class: "card" },
        h("h2", { class: "card-title" }, "시험 유형별 정답률"),
        formats.map((f) => {
          const row = byFormat[f];
          const acc = row ? row.correct / row.n : 0;
          return h("div", { class: "sec-row" },
            h("div", { class: "sec-top" }, h("span", null, FORMAT_LABEL[f].ko, h("small", null, ` · ${FORMAT_LABEL[f].en}`)),
              h("b", null, row ? `${pct(acc)}` : "–", h("small", null, row ? ` · ${row.n}문제` : " · 아직 없어요"))),
            meter(acc, "learning", `${FORMAT_LABEL[f].ko} 정답률 ${row ? pct(acc) : "없음"}`));
        })),
      Object.keys(byType).length ? h("section", { class: "card" },
        h("h2", { class: "card-title" }, "문제 모양별 정답률"),
        h("p", { class: "card-sub" }, "단계별 계산과 서술형은 통과 기준을 넘으면 정답으로 셌어요"),
        h("div", { class: "type-grid" }, Object.keys(TYPE_LABEL).filter((t) => byType[t]).map((t) => {
          const row = byType[t];
          return h("div", { class: "type-cell" }, h("span", null, TYPE_LABEL[t]), h("b", null, pct(row.correct / row.n)), h("small", null, `${row.n}문제`));
        }))) : null,
      conceptGroups(ctx),
    ],
  }));
  ctx.teardown = trendChart(chartBox, rollingAccuracy(hist, 50, 10), hist.length);
}

/**
 * Single-series line chart (rolling accuracy, 0–100%): 2px line, 10% wash, hairline grid, end dot with a
 * direct label, crosshair + tooltip on hover and on keyboard focus (←/→), and a table view.
 * Returns a cleanup function.
 */
function trendChart(box, values, total) {
  if (values.length < 3) {
    box.append(h("p", { class: "empty" }, "세 문제 이상 풀면 추이가 보여요."));
    return null;
  }
  const NS = "http://www.w3.org/2000/svg";
  const svgEl = (tag, attrs) => {
    const el = document.createElementNS(NS, tag);
    for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
    return el;
  };
  const offset = total - values.length; // answer number of the first point = offset + 1
  const tip = h("div", { class: "chart-tip", role: "status", "aria-live": "polite" });
  const plot = h("div", { class: "chart-plot", tabindex: "0", role: "group",
    "aria-label": `최근 ${values.length}문제 정답률 추이, 마지막 ${pct(values[values.length - 1])}. 좌우 화살표로 살펴볼 수 있어요.` });
  const table = h("details", { class: "chart-table" }, h("summary", null, "표로 보기"),
    h("table", null, h("thead", null, h("tr", null, h("th", null, "문제"), h("th", null, "직전 10문제 정답률"))),
      h("tbody", null, values.map((v, i) => h("tr", null, h("td", null, `${offset + i + 1}번째`), h("td", null, pct(v)))))));
  box.append(plot, table);
  plot.append(tip);

  let active = null;
  let geom = null;
  const draw = () => {
    plot.querySelector("svg")?.remove();
    const W = Math.max(260, plot.clientWidth);
    const H = 168;
    const pad = { l: 40, r: 44, t: 12, b: 24 };
    const x = (i) => pad.l + (values.length === 1 ? 0 : (i / (values.length - 1)) * (W - pad.l - pad.r));
    const y = (v) => pad.t + (1 - v) * (H - pad.t - pad.b);
    geom = { x, y, W, H, pad };
    const svg = svgEl("svg", { width: W, height: H, viewBox: `0 0 ${W} ${H}`, "aria-hidden": "true" });
    for (const g of [0, 0.5, 1]) {
      svg.append(svgEl("line", { x1: pad.l, x2: W - pad.r, y1: y(g), y2: y(g), class: "grid" }));
      const t = svgEl("text", { x: pad.l - 8, y: y(g) + 4, class: "axis", "text-anchor": "end" });
      t.textContent = `${g * 100}%`;
      svg.append(t);
    }
    const xl = svgEl("text", { x: pad.l, y: H - 6, class: "axis" });
    xl.textContent = `${offset + 1}번째`;
    const xr = svgEl("text", { x: W - pad.r, y: H - 6, class: "axis", "text-anchor": "end" });
    xr.textContent = "최근";
    svg.append(xl, xr);
    const pts = values.map((v, i) => `${x(i).toFixed(1)},${y(v).toFixed(1)}`);
    svg.append(svgEl("path", { d: `M${pts[0]} L${pts.join(" L")} L${x(values.length - 1)},${y(0)} L${x(0)},${y(0)} Z`, class: "area" }));
    svg.append(svgEl("path", { d: `M${pts.join(" L")}`, class: "line" }));
    const lx = x(values.length - 1);
    const ly = y(values[values.length - 1]);
    svg.append(svgEl("circle", { cx: lx, cy: ly, r: 4.5, class: "end-dot" }));
    const end = svgEl("text", { x: lx + 8, y: ly + 4, class: "end-label" });
    end.textContent = pct(values[values.length - 1]);
    svg.append(end);
    svg.append(svgEl("line", { x1: 0, x2: 0, y1: pad.t, y2: H - pad.b, class: "crosshair", visibility: "hidden" }));
    svg.append(svgEl("circle", { cx: 0, cy: 0, r: 4.5, class: "hover-dot", visibility: "hidden" }));
    plot.prepend(svg);
    if (active != null) show(active);
  };
  const show = (i) => {
    active = Math.max(0, Math.min(values.length - 1, i));
    const svg = plot.querySelector("svg");
    const cx = geom.x(active);
    const cy = geom.y(values[active]);
    const cross = svg.querySelector(".crosshair");
    const dot = svg.querySelector(".hover-dot");
    cross.setAttribute("x1", cx);
    cross.setAttribute("x2", cx);
    cross.setAttribute("visibility", "visible");
    dot.setAttribute("cx", cx);
    dot.setAttribute("cy", cy);
    dot.setAttribute("visibility", "visible");
    tip.replaceChildren(h("b", null, pct(values[active])), h("span", null, `${offset + active + 1}번째 문제까지 직전 10문제`));
    tip.style.left = `${Math.min(Math.max(cx, 70), geom.W - 70)}px`;
    tip.classList.add("in");
  };
  const hide = () => {
    active = null;
    tip.classList.remove("in");
    plot.querySelectorAll(".crosshair, .hover-dot").forEach((el) => el.setAttribute("visibility", "hidden"));
  };
  plot.addEventListener("pointermove", (e) => {
    const r = plot.getBoundingClientRect();
    const px = e.clientX - r.left;
    const span = geom.W - geom.pad.l - geom.pad.r;
    show(Math.round(((px - geom.pad.l) / span) * (values.length - 1)));
  });
  plot.addEventListener("pointerleave", () => { if (document.activeElement !== plot) hide(); });
  plot.addEventListener("focus", () => show(active ?? values.length - 1));
  plot.addEventListener("blur", hide);
  plot.addEventListener("keydown", (e) => {
    if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
      e.preventDefault();
      show((active ?? values.length - 1) + (e.key === "ArrowLeft" ? -1 : 1));
    }
  });
  const ro = new ResizeObserver(() => draw());
  ro.observe(plot);
  return () => ro.disconnect();
}

// ---- concepts -----------------------------------------------------------------------------------------

export function renderConcepts(ctx) {
  const sum = summarize(ctx.S.engine, ctx.B.bank.concepts, ctx.B.bank);
  ctx.mount(shell({
    cls: "is-sub",
    top: backTop("#/"),
    content: [
      h("h1", { class: "title" }, "어떤 개념을 연습할까요?"),
      h("p", { class: "sub" }, `${sum.total}개 중 ${sum.mastered}개를 완료했어요. 고른 개념만 쉬운 문제부터 풀 수 있어요.`),
      easyIntro(ctx),
      conceptGroups(ctx),
    ],
  }));
}

/** "문제 풀기 전에" — the concepts that have a 쉬운 설명, in curriculum order. */
function easyIntro(ctx) {
  const list = ctx.B.bank.concepts.filter((c) => c.easy);
  if (!list.length) return null;
  return h("section", { class: "card ez-intro" },
    h("p", { class: "ez-intro-eyebrow" }, "문제 풀기 전에"),
    h("h2", { class: "card-title" }, "그림으로 먼저 보는 쉬운 설명"),
    h("p", { class: "card-sub" }, `머신러닝 기초부터 ResNet까지 ${list.length}개 개념을 중학생도 알 수 있는 말과 그림으로 정리했어요. 순서대로 읽고 바로 풀어 보세요.`),
    h("ol", { class: "ez-intro-list" }, list.map((c, i) => h("li", null,
      h("a", { href: `#/concept/${encodeURIComponent(c.id)}` },
        h("span", { class: "ez-intro-no" }, String(i + 1)),
        h("span", { class: "ez-intro-tx" }, h("b", null, shortTitle(c.title_ko)), h("span", null, `${c.week}주차 · ${c.ref}`)),
        icon("next", 18))))),
    btn("1번부터 읽기", { href: `#/concept/${encodeURIComponent(list[0].id)}`, cls: "ez-intro-cta" }));
}

/** 이전/다음 쉬운 설명 links at the bottom of a 쉬운 설명. */
function easyNav(ctx, cid) {
  const list = ctx.B.bank.concepts.filter((c) => c.easy);
  const i = list.findIndex((c) => c.id === cid);
  const link = (c, dir) => c
    ? h("a", { class: `ez-nav-${dir}`, href: `#/concept/${encodeURIComponent(c.id)}` },
      dir === "prev" ? icon("back", 18) : null,
      h("span", null, h("small", null, dir === "prev" ? "이전 설명" : "다음 설명"), h("b", null, shortTitle(c.title_ko))),
      dir === "next" ? icon("next", 18) : null)
    : h("span");
  return h("nav", { class: "ez-nav", "aria-label": "쉬운 설명 이동" },
    link(list[i - 1], "prev"), h("span", { class: "ez-nav-at" }, `${i + 1} / ${list.length}`), link(list[i + 1], "next"));
}

export function renderConceptDetail(ctx, cid) {
  const { B, S } = ctx;
  const c = B.bank.conceptById[cid];
  if (!c) return ctx.go("#/concepts");
  const cs = peekConcept(S.engine, cid);
  const st = conceptStatus(S.engine.concepts[cid]);
  const m = masteryOf(S.engine, cid, B.bank);
  const hint = masteryHint(S.engine.concepts[cid], l3Needed(B.bank, cid));
  const hist = S.engine.history.filter((x) => x.concept === cid).slice(-20).reverse();
  const back = /^#\/(stats|wrong|concepts)/.test(ctx.prevHash || "") ? ctx.prevHash : "#/concepts";
  const count = (B.bank.byConcept[cid] || []).length;

  const easy = c.easy ? [
    h("h2", { class: "section-title" }, "쉬운 설명", h("small", null, "문제 풀기 전에 먼저 읽어요")),
    h("div", { class: "card" }, easyView(c)),
    easyNav(ctx, cid),
  ] : null;

  ctx.mount(shell({
    cls: "is-sub",
    top: backTop(back),
    content: [
      h("p", { class: "eyebrow" }, `${c.week}주차 · ${c.ref}`),
      h("h1", { class: "title" }, c.title_ko),
      h("p", { class: "sub en" }, c.title_en),
      easy,
      easy ? h("h2", { class: "section-title" }, "내 숙련도") : null,
      h("div", { class: "card" },
        h("div", { class: "summary-top" },
          h("div", null, h("span", { class: "label" }, "숙련도"), h("strong", { class: "big" }, pct(m))),
          h("span", { class: `chip ${STATUS_CHIP[st]}` }, STATUS_LABEL[st])),
        meter(m, st),
        hint && cs.n ? h("p", { class: "meter-hint" }, hint) : null,
        h("div", { class: "stat-row" },
          h("div", null, h("span", null, "푼 문제"), h("b", null, String(cs.n))),
          h("div", null, h("span", null, "정답률"), h("b", null, cs.n ? pct(cs.correct / cs.n) : "–")),
          h("div", null, h("span", null, "지금 난이도"), h("b", null, LEVEL_LABEL[cs.level])))),
      h("h2", { class: "section-title" }, "개념 카드", easy ? h("small", null, "시험용 요약") : null),
      h("div", { class: "card" }, cardView(c)),
      h("h2", { class: "section-title" }, "내 기록"),
      hist.length
        ? h("div", { class: "card flush" }, h("ul", { class: "hist" }, hist.map((x) => {
          const q = B.bank.byId.get(x.qid);
          const inner = [
            h("span", { class: "hist-ic", role: "img", "aria-label": x.correct ? "정답" : "오답" }, icon(x.correct ? "check" : "alert", 18)),
            h("span", { class: "hist-tx" }, h("b", { html: mdInline(q ? q.prompt_ko || q.prompt_en : x.qid, { refs: false }) }),
              h("span", null, `${LEVEL_LABEL[x.level] || ""} · ${FORMAT_LABEL[x.format]?.ko || ""}${x.review ? " · 복습" : ""} · ${timeAgo(x.t)}`)),
          ];
          return h("li", { class: x.correct ? "ok" : "bad" }, q
            ? h("a", { class: "hist-row", href: `#/retry/${encodeURIComponent(x.qid)}`, title: "이 문제 다시 풀기" }, inner, icon("next", 18))
            : h("div", { class: "hist-row" }, inner));
        })))
        : h("p", { class: "empty card" }, "아직 이 개념 문제를 풀지 않았어요."),
    ],
    cta: btn(count ? "이 개념만 연습" : "문제 준비 중이에요", { href: count ? `#/practice/${encodeURIComponent(cid)}` : null, disabled: !count }),
  }));
}

// ---- 오답노트 -----------------------------------------------------------------------------------------

export function renderWrong(ctx) {
  const { B, S } = ctx;
  const items = wrongList(S.engine).filter((w) => B.bank.byId.has(w.qid));
  ctx.mount(shell({
    cls: "is-sub",
    top: backTop("#/"),
    content: [
      h("h1", { class: "title" }, "오답노트"),
      h("p", { class: "sub" }, items.length ? `마지막으로 틀린 문제 ${items.length}개예요. 다시 맞히면 여기서 빠져요.` : "지금은 틀린 문제가 없어요. 잘하고 있어요."),
      items.length ? h("div", { class: "card flush" }, h("ul", { class: "wrong-list" }, items.map((w) => {
        const q = B.bank.byId.get(w.qid);
        const c = B.bank.conceptById[q.concept];
        return h("li", null, h("a", { href: `#/retry/${encodeURIComponent(w.qid)}`, class: "wrong-row" },
          h("span", { class: "wrong-meta" }, conceptChip(c), sourceBadge(q), levelDots(q.level)),
          h("b", { html: mdInline(q.prompt_ko || q.prompt_en, { refs: false }) }),
          h("span", { class: "wrong-sub" }, `${FORMAT_LABEL[q.format]?.ko || ""} · ${w.wrong}번 틀림 · ${timeAgo(w.t)}`),
          icon("next", 18)));
      }))) : null,
    ],
    cta: items.length ? btn(items.length > 20 ? "최근 20개 다시 풀기" : "전부 다시 풀기", { href: "#/retry" }) : btn("추천 학습으로", { href: "#/learn" }),
  }));
}
