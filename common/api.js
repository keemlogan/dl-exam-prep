// Small client for server.py: progress storage (server file + localStorage mirror) and JSON loading.
// Deep Learning midterm: Tue 2026-10-20 14:00–16:00 KST (SPEC §0).
export const EXAM_AT = new Date("2026-10-20T14:00:00+09:00");

/** localStorage key prefix — never localStorage.clear(): the origin is shared with other local projects. */
export const LS_PREFIX = "dl-progress-";

export function dDay(now = new Date()) {
  const day = 24 * 60 * 60 * 1000;
  const kst = (d) => Math.floor((d.getTime() + 9 * 3600 * 1000) / day);
  return kst(EXAM_AT) - kst(now); // 3 => "D-3", 0 => "D-DAY"
}

// When was this copy saved? (_savedAt is stamped by saveProgress; older copies may only carry updatedAt.)
const stamp = (d) => (d && (d._savedAt || d.updatedAt)) || 0;

// ---- static build (GitHub Pages): no server.py ----
export const ROOT = new URL("../", import.meta.url).href;

export async function loadProgress(name) {
  let local = null;
  try {
    const raw = localStorage.getItem(`dl-progress-${name}`);
    local = raw ? JSON.parse(raw) : null;
  } catch { /* private mode / bad JSON */ }
  if (local) return local;
  try {  // first visit: start from the progress copied from the Mac at build time
    const res = await fetch(`${ROOT}data/progress-${name}.json`, { cache: "no-store" });
    if (res.ok) return await res.json();
  } catch { /* none */ }
  return null;
}

export function saveProgress(name, data, { keepStamp = false } = {}) {
  if (data && typeof data === "object" && !keepStamp) data._savedAt = Date.now();
  try { localStorage.setItem(`dl-progress-${name}`, JSON.stringify(data)); } catch { /* quota/private mode */ }
  return Promise.resolve();
}

export async function loadJSON(url) {
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
  return res.json();
}
