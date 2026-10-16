import { ROOT } from "../common/api.js";
// #/guide — 시험 분석: renders data/guide.json `{title, updated, sections: [{h, md}]}` (md = markdown-lite with
// tables and $math$). A missing or broken file shows a placeholder instead of an error.
import { loadJSON } from "../common/api.js";
import { md } from "./question.js";
import { btn, h, icon, iconBtn, shell } from "./ui.js";

let cache = null; // {data} | {missing: true}

async function loadGuide() {
  if (cache) return cache;
  try {
    const data = await loadJSON(ROOT+"data/guide.json");
    if (!data || !Array.isArray(data.sections)) throw new Error("no sections");
    cache = { data };
  } catch (err) {
    console.warn(`[guide] /data/guide.json not available (${err.message || err}); showing a placeholder.`);
    cache = { missing: true };
  }
  return cache;
}

function slug(i) {
  return `guide-${i + 1}`;
}

export async function renderGuide(ctx) {
  const top = [iconBtn("back", "뒤로", { href: /^#\/(stats|mock|concepts)/.test(ctx.prevHash || "") ? ctx.prevHash : "#/" })];
  ctx.mount(shell({ cls: "is-sub", top, content: [h("p", { class: "sub loading" }, "시험 분석을 불러오는 중이에요…")] }));
  const g = await loadGuide();
  if (!/^#\/guide/.test(location.hash)) return; // the student moved on while loading
  if (g.missing) {
    return ctx.mount(shell({
      cls: "is-sub is-center", top,
      content: [h("span", { class: "guide-ph-ic", "aria-hidden": "true" }, icon("guide", 32)),
        h("h1", { class: "title" }, "시험 분석을 준비하고 있어요"),
        h("p", { class: "sub" }, "기출과 올해 공지를 정리한 분석이 곧 여기에 올라와요. 그동안 추천 학습으로 약한 개념부터 채워 봐요.")],
      cta: btn("추천 학습 시작하기", { href: "#/learn" }),
    }));
  }
  const { data } = g;
  const sections = data.sections.filter((s) => s && (s.h || s.md));
  const toc = sections.length > 2 ? h("nav", { class: "card guide-toc", "aria-label": "목차" },
    h("p", { class: "ez-label" }, "목차"),
    h("ol", null, sections.map((s, i) => {
      const a = h("a", { href: `#${slug(i)}` }, s.h || `섹션 ${i + 1}`);
      a.addEventListener("click", (e) => {
        e.preventDefault(); // keep the hash route
        document.getElementById(slug(i))?.scrollIntoView({ behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
      });
      return h("li", null, a);
    }))) : null;
  ctx.mount(shell({
    cls: "is-sub",
    top,
    content: [
      h("p", { class: "eyebrow" }, data.updated ? `시험 분석 · ${data.updated} 업데이트` : "시험 분석"),
      h("h1", { class: "title" }, data.title || "딥러닝 중간고사 분석"),
      toc,
      sections.map((s, i) => h("section", { class: "card guide-sec", id: slug(i) },
        s.h ? h("h2", { class: "card-title" }, s.h) : null,
        s.md ? md("div", "md guide-md", s.md) : null)),
    ],
    cta: [btn("실전 모의고사", { kind: "secondary", cls: "is-narrow", href: "#/mock" }), btn("추천 학습 시작하기", { href: "#/learn" })],
  }));
}
