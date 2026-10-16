// Small DOM helpers shared by the trainer screens: element builder, icons, bottom sheets, toasts.

export function h(tag, props, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props || {})) {
    if (v == null || v === false) continue;
    if (k === "class") el.className = v;
    else if (k === "html") el.innerHTML = v;
    else if (k === "style") el.style.cssText = v;
    else if (k.startsWith("on") && typeof v === "function") el.addEventListener(k.slice(2).toLowerCase(), v);
    else el.setAttribute(k, v === true ? "" : v);
  }
  for (const kid of kids.flat(Infinity)) {
    if (kid == null || kid === false) continue;
    el.append(kid.nodeType ? kid : String(kid));
  }
  return el;
}

const PATHS = {
  close: '<path d="M6 6l12 12M18 6L6 18"/>',
  back: '<path d="M15 5l-7 7 7 7"/>',
  next: '<path d="M9 5l7 7-7 7"/>',
  check: '<path d="M5 12.5l4.5 4.5L19 7.5"/>',
  alert: '<path d="M12 7v6"/><path d="M12 16.5v.5"/>',
  minus: '<path d="M7 12h10"/>',
  plus: '<path d="M12 7v10M7 12h10"/>',
  expand: '<path d="M14 4h6v6M10 20H4v-6M20 4l-6.5 6.5M4 20l6.5-6.5"/>',
  clock: '<circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/>',
  book: '<path d="M5 5.5A1.5 1.5 0 0 1 6.5 4H19v14H6.5A1.5 1.5 0 0 0 5 19.5z"/><path d="M5 19.5A1.5 1.5 0 0 0 6.5 21H19"/>',
  chart: '<path d="M5 19V9M12 19V5M19 19v-7"/>',
  spark: '<path d="M12 3v4M12 17v4M3 12h4M17 12h4M6 6l2.5 2.5M15.5 15.5L18 18M6 18l2.5-2.5M15.5 8.5L18 6"/>',
  target: '<circle cx="12" cy="12" r="8.5"/><circle cx="12" cy="12" r="4.5"/><circle cx="12" cy="12" r="1"/>',
  list: '<path d="M9 6.5h10M9 12h10M9 17.5h10"/><path d="M5 6.5h.01M5 12h.01M5 17.5h.01"/>',
  retry: '<path d="M4.5 12a7.5 7.5 0 1 0 2.2-5.3"/><path d="M4.5 4.5v4h4"/>',
  exam: '<rect x="5" y="3.5" width="14" height="17" rx="2"/><path d="M9 8.5h6M9 12h6M9 15.5h3"/>',
  home: '<path d="M4 11l8-6.5 8 6.5"/><path d="M6.5 9.5V19h11V9.5"/>',
  calc: '<rect x="5" y="3" width="14" height="18" rx="2.5"/><path d="M8.5 7.5h7"/><path d="M8.5 11.5h.01M12 11.5h.01M15.5 11.5h.01M8.5 15h.01M12 15h.01M15.5 15h.01M8.5 18h.01M12 18h3.5"/>',
  guide: '<path d="M6 3.5h8.5L18 7v13.5H6z"/><path d="M14 3.5V7.5h4"/><path d="M9 12h6M9 15.5h6M9 8.5h2.5"/>',
  pen: '<path d="M14.5 5.5l4 4L9 19H5v-4z"/><path d="M12.5 7.5l4 4"/>',
  steps: '<path d="M4 18h5v-4.5h5V9h6"/><path d="M17 6l3 3-3 3"/>',
};

/** Inline 24px stroke icon. */
export function icon(name, size = 24) {
  const span = document.createElement("span");
  span.className = `ic ic-${name}`;
  span.setAttribute("aria-hidden", "true");
  span.innerHTML = `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" ` +
    `stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${PATHS[name] || ""}</svg>`;
  return span;
}

export const reduceMotion = () => matchMedia("(prefers-reduced-motion: reduce)").matches;

// ---- bottom sheets ------------------------------------------------------------------------------------

const sheets = [];

/** Open a bottom sheet. Esc / scrim close it when `dismissible`. Returns `{el, close}`. */
export function openSheet(content, { label = "", onClose, dismissible = true, className = "" } = {}) {
  const prev = document.activeElement;
  const scrim = h("div", { class: "scrim" });
  const panel = h("div", { class: `sheet ${className}`, role: "dialog", "aria-modal": "true", "aria-label": label,
    tabindex: "-1" }, h("div", { class: "sheet-grip", "aria-hidden": "true" }), content);
  document.body.append(scrim, panel);
  document.body.classList.add("has-sheet");
  requestAnimationFrame(() => requestAnimationFrame(() => {
    scrim.classList.add("in");
    panel.classList.add("in");
  }));
  let closed = false;
  const api = {
    el: panel, dismissible,
    close(reason = "code") {
      if (closed) return;
      closed = true;
      sheets.splice(sheets.indexOf(api), 1);
      scrim.classList.remove("in");
      panel.classList.remove("in");
      const remove = () => { scrim.remove(); panel.remove(); };
      if (reduceMotion()) remove();
      else setTimeout(remove, 260);
      if (!sheets.length) document.body.classList.remove("has-sheet");
      if (reason !== "route" && prev && document.contains(prev)) prev.focus({ preventScroll: true });
      onClose?.(reason);
    },
  };
  if (dismissible) scrim.addEventListener("click", () => api.close("scrim"));
  sheets.push(api);
  panel.focus({ preventScroll: true });
  return api;
}

export function topSheet() {
  return sheets[sheets.length - 1] || null;
}

export function closeAllSheets() {
  while (sheets.length) sheets[sheets.length - 1].close("route");
}

/** Keep Tab focus inside the top sheet. Returns true when handled. */
export function trapTab(e) {
  const s = topSheet();
  if (!s || e.key !== "Tab") return false;
  const items = [...s.el.querySelectorAll("button, [href], input, textarea, [tabindex]:not([tabindex='-1'])")]
    .filter((el) => !el.disabled && el.offsetParent !== null);
  if (!items.length) return false;
  const first = items[0];
  const last = items[items.length - 1];
  if (!s.el.contains(document.activeElement)) {
    first.focus();
    e.preventDefault();
    return true;
  }
  if (e.shiftKey && document.activeElement === first) {
    last.focus();
    e.preventDefault();
    return true;
  }
  if (!e.shiftKey && document.activeElement === last) {
    first.focus();
    e.preventDefault();
    return true;
  }
  return false;
}

// ---- toast --------------------------------------------------------------------------------------------

let toastTimer = null;
export function toast(message) {
  let el = document.querySelector(".toast");
  if (!el) {
    el = h("div", { class: "toast", role: "status", "aria-live": "polite" });
    document.body.append(el);
  }
  el.textContent = message;
  el.classList.add("in");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove("in"), 2600);
}

/** "방금 전", "3분 전", "어제" … */
export function timeAgo(t, now = Date.now()) {
  const s = Math.max(0, (now - t) / 1000);
  if (s < 60) return "방금 전";
  if (s < 3600) return `${Math.floor(s / 60)}분 전`;
  if (s < 86400) return `${Math.floor(s / 3600)}시간 전`;
  if (s < 172800) return "어제";
  return `${Math.floor(s / 86400)}일 전`;
}

// ---- screen pieces ------------------------------------------------------------------------------------

/** A full screen: sticky top bar, content column, fixed bottom CTA bar. */
export function shell({ cls = "", top = null, content = [], cta = null }) {
  return h("div", { class: `screen ${cls}` },
    top ? h("header", { class: "topbar" }, h("div", { class: "topbar-in" }, top)) : null,
    h("main", { class: "content", id: "main", tabindex: "-1" }, content),
    cta ? h("div", { class: "cta-bar" }, cta.classList?.contains("cta-in") ? cta : h("div", { class: "cta-in" }, cta)) : null);
}

/** Button: kind = "primary" | "secondary" | "text". With `href` it renders a link styled as a button. */
export function btn(label, { kind = "primary", onClick, href, disabled = false, cls = "", ...rest } = {}) {
  const el = href
    ? h("a", { class: `btn btn-${kind} ${cls}`, href, ...rest }, label)
    : h("button", { class: `btn btn-${kind} ${cls}`, type: "button", disabled, ...rest }, label);
  if (onClick) el.addEventListener("click", onClick);
  return el;
}

export function iconBtn(name, label, { onClick, href } = {}) {
  const el = href
    ? h("a", { class: "icon-btn", href, "aria-label": label, title: label }, icon(name))
    : h("button", { class: "icon-btn", type: "button", "aria-label": label, title: label }, icon(name));
  if (onClick) el.addEventListener("click", onClick);
  return el;
}

/** Thin progress bar with a label; returns `{el, set(value 0–1, label)}`. */
export function progressBar(value = 0, label = "", name = "진행률") {
  const fill = h("i", { class: "pbar-fill" });
  const bar = h("div", { class: "pbar", role: "progressbar", "aria-label": name, "aria-valuemin": "0", "aria-valuemax": "100" }, fill);
  const text = h("span", { class: "pbar-label" });
  const el = h("div", { class: "pbar-wrap" }, bar, text);
  const set = (v, l) => {
    const p = Math.round(Math.max(0, Math.min(1, v)) * 100);
    fill.style.width = `${p}%`;
    bar.setAttribute("aria-valuenow", String(p));
    text.textContent = l;
  };
  set(value, label);
  return { el, set };
}
