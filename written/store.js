import { ROOT } from "../common/api.js";
// Loading the question bank and the saved progress.
// The app loads /data/written.bundle.json (built by tools/verify_written.py). With ?dev=1 — or when the real
// bundle is missing (a warning is logged) — it uses web/written/dev/written.bundle.json and keeps progress in
// this browser only, so a fake bank never touches the real progress file.
import { loadJSON, loadProgress, saveProgress } from "../common/api.js";
import { indexBank, normalizeState } from "./engine.js";

export const DEV_BUNDLE = ROOT+"written/dev/written.bundle.json";
export const REAL_BUNDLE = ROOT+"data/written.bundle.json";
const DEV_KEY = "dl-dev-written";

/** True with ?dev=1 or after falling back to the dev bundle (live binding: read it after loadBank()). */
export let DEV = typeof location !== "undefined" && new URLSearchParams(location.search).has("dev");

export async function loadBank() {
  let bundle = null;
  if (!DEV) {
    try {
      bundle = await loadJSON(REAL_BUNDLE);
      if (!Array.isArray(bundle?.questions)) throw new Error("no questions in bundle");
    } catch (err) {
      console.warn(`[written] ${REAL_BUNDLE} is missing or unreadable (${err.message || err}); using the dev bundle ${DEV_BUNDLE}. ` +
        "Progress stays in this browser only. Build the real bundle with tools/verify_written.py.");
      DEV = true;
      bundle = null;
    }
  }
  if (!bundle) bundle = await loadJSON(DEV_BUNDLE);
  return { bundle, bank: indexBank(bundle) };
}

/** Saved progress: `{v, engine, session, mock, prefs, updatedAt}` (see app.js for session/mock). */
export function normalizeSaved(raw) {
  const r = raw && typeof raw === "object" ? raw : {};
  return {
    v: 1,
    engine: normalizeState(r.engine),
    session: r.session && typeof r.session === "object" ? r.session : null,
    mock: r.mock && typeof r.mock === "object" ? r.mock : null,
    prefs: { hideKo: false, ...(r.prefs || {}) },
    updatedAt: r.updatedAt || null,
  };
}

/** Call after loadBank() so a dev fallback also keeps progress local. */
export async function loadSaved() {
  if (DEV) {
    try {
      return normalizeSaved(JSON.parse(localStorage.getItem(DEV_KEY)));
    } catch {
      return normalizeSaved(null);
    }
  }
  return normalizeSaved(await loadProgress("written"));
}

export function save(saved, { immediate = false } = {}) {
  saved.updatedAt = Date.now();
  if (DEV) {
    try { localStorage.setItem(DEV_KEY, JSON.stringify(saved)); } catch { /* private mode */ }
    return;
  }
  saveProgress("written", saved, { immediate });
}
