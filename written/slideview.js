// Slide images in the trainer: inline figures under an explanation, the "슬라이드 보기" sheet behind a ref chip,
// slide links inside text (render.js emits <button class="slide-link" data-ref>), and a full-screen viewer
// (zoom with +/− or a click, ←/→ between pages, Esc closes).
import { refLabel } from "./render.js";
import { deckPages, parseSlideRefs, slideLabel, slideSize, slideUrl } from "./slides.js";
import { btn, h, icon, openSheet } from "./ui.js";

const ZOOMS = [1, 1.5, 2, 3];

function slideImg(s, cls) {
  const { w, h: ht } = slideSize(s);
  const img = h("img", { class: cls, src: slideUrl(s), alt: `슬라이드 ${slideLabel(s)}`, loading: "lazy", decoding: "async",
    width: String(w), height: String(ht), style: `--ar:${w / ht}` });
  img.addEventListener("error", () => img.closest(".slide-fig")?.classList.add("is-missing"));
  return img;
}

/** One slide as a clickable figure; `list`/`i` decide what the viewer can page through. */
export function slideFigure(list, i, caption) {
  const s = list[i];
  const tall = slideSize(s).h > slideSize(s).w;
  const open = h("button", { type: "button", class: "slide-btn", "aria-label": `${slideLabel(s)} 크게 보기` },
    slideImg(s, "slide-img"), h("span", { class: "slide-zoom", "aria-hidden": "true" }, icon("expand", 18)));
  open.addEventListener("click", () => openSlideViewer(list, i));
  return h("figure", { class: `slide-fig${tall ? " is-tall" : ""}` }, open, h("figcaption", null, caption ?? slideLabel(s)));
}

/** The slides an explanation cites, shown right under it (at most 2). */
export function slidesInline(list) {
  const shown = list.slice(0, 2);
  if (!shown.length) return null;
  return h("div", { class: "slides-inline" }, shown.map((s, i) => slideFigure(shown, i, `슬라이드 ${slideLabel(s)} 원문`)));
}

/**
 * Full-screen viewer. Pages through `list`; when only one page was cited it pages through that whole deck
 * (so the slides before/after are one tap away).
 */
export function openSlideViewer(list, start = 0) {
  if (list.length === 1) {
    const deck = deckPages(list[0].lec);
    if (deck.length > 1) {
      start = list[0].page - 1;
      list = deck;
    }
  }
  let i = start;
  let z = 0;
  const img = h("img", { class: "viewer-img", alt: "" });
  const stage = h("div", { class: "viewer-stage" }, img);
  const title = h("span", { class: "viewer-title", "aria-live": "polite" });
  const tool = (name, label, fn) => {
    const b = h("button", { type: "button", class: "icon-btn", "aria-label": label, title: label }, icon(name));
    b.addEventListener("click", fn);
    return b;
  };
  const prev = tool("back", "이전 슬라이드 (←)", () => show(i - 1));
  const next = tool("next", "다음 슬라이드 (→)", () => show(i + 1));
  const out = tool("minus", "축소 (−)", () => zoom(z - 1));
  const inn = tool("plus", "확대 (+)", () => zoom(z + 1));
  const close = tool("close", "닫기 (Esc)", () => sheet.close("button"));
  const zoom = (k) => {
    z = Math.max(0, Math.min(ZOOMS.length - 1, k));
    stage.style.setProperty("--z", String(ZOOMS[z]));
    img.classList.toggle("is-zoomed", z > 0);
    out.disabled = z === 0;
    inn.disabled = z === ZOOMS.length - 1;
  };
  const show = (k) => {
    i = Math.max(0, Math.min(list.length - 1, k));
    const s = list[i];
    const { w, h: ht } = slideSize(s);
    img.src = slideUrl(s);
    img.width = w;
    img.height = ht;
    img.style.setProperty("--ar", String(w / ht));
    img.alt = `슬라이드 ${slideLabel(s)}`;
    title.textContent = list.length > 1 ? `${slideLabel(s)} · ${i + 1}/${list.length}` : slideLabel(s);
    prev.disabled = i === 0;
    next.disabled = i === list.length - 1;
    zoom(0);
    stage.scrollTo?.(0, 0);
  };
  img.addEventListener("click", () => zoom(z === 0 ? 2 : 0));
  const bar = h("div", { class: "viewer-bar" }, title, list.length > 1 ? [prev, next] : null, out, inn, close);
  const sheet = openSheet(h("div", { class: "viewer-in" }, bar, stage), { label: "슬라이드 크게 보기", className: "viewer" });
  sheet.el.addEventListener("keydown", (e) => {
    const k = e.key;
    if (k === "+" || k === "=") zoom(z + 1);
    else if (k === "-" || k === "_") zoom(z - 1);
    else if (k === "ArrowLeft" && list.length > 1) show(i - 1);
    else if (k === "ArrowRight" && list.length > 1) show(i + 1);
    else return;
    e.preventDefault();
  });
  show(start);
  return sheet;
}

/** Sheet with every referenced page stacked, each one opening the viewer. One page opens the viewer directly. */
export function openSlidesSheet(list, label) {
  if (list.length === 1) return openSlideViewer(list, 0);
  const sheet = openSheet(h("div", { class: "sheet-body" },
    h("h2", { class: "sheet-title" }, "슬라이드 보기"),
    h("p", { class: "sub" }, label),
    h("div", { class: "slides-stack" }, list.map((s, i) => slideFigure(list, i, slideLabel(s)))),
    h("div", { class: "sheet-cta" }, btn("닫기", { onClick: () => sheet.close("button") }))),
  { label: "슬라이드 보기", className: "slides-sheet" });
  return sheet;
}

/** "lec04-2 p.24–26 · 강의노트 4주차" — a button that opens the slides when the ref names pages, a plain chip otherwise. */
export function refChip(ref, label = refLabel(ref)) {
  const list = parseSlideRefs(ref);
  if (!list.length) return h("span", { class: "ref-chip" }, icon("book", 16), label);
  const b = h("button", { type: "button", class: "ref-chip is-button" }, icon("book", 16), h("span", null, label),
    h("span", { class: "ref-more" }, "슬라이드 보기"), icon("next", 14));
  b.addEventListener("click", () => openSlidesSheet(list, label));
  return b;
}

// slide links inside rendered text (explanations, cards, guide …)
if (typeof document !== "undefined") {
  document.addEventListener("click", (e) => {
    const link = e.target.closest?.(".slide-link[data-ref]");
    if (!link) return;
    const list = parseSlideRefs(link.dataset.ref);
    if (!list.length) return;
    e.preventDefault();
    e.stopPropagation();
    openSlidesSheet(list, refLabel(link.dataset.ref));
  });
}
