// Small client for server.py: progress storage (server file + localStorage mirror + cloud sync) and JSON loading.
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

// ---- cloud sync: one row per progress name in Supabase (tools/sync_setup.sql) --------------------------
// The Mac app and the GitHub Pages copy share it, so progress follows you between devices. Access needs a
// secret token: the Mac server hands it out (~/.config/dl-exam/sync-token); a phone gets it once from a
// link with ?k=<token>, kept in localStorage. The newest save wins; a device that comes back to the
// foreground reloads when another device saved after it.
const CLOUD_RPC = "https://dbahxuegxnqsthntpuqy.supabase.co/rest/v1/rpc/";
const CLOUD_KEY = "sb_publishable_Efbr07Evn3lAJUKUqmZWmg_EvWp5DkY"; // publishable (public) key; the token is what guards the row
const TOKEN_KEY = "dl-sync-token";
/** false in the GitHub Pages copy (tools/build_static.py): no server.py, the cloud row is the only shared copy. */
const HAS_SERVER = false;

/** status: "off" (no token) | "ok" | "error"; base[name] = cloud saved_at this device last saw or wrote. */
export const cloud = { status: "off", base: {}, at: 0 };

// ?k= stays in the address bar on purpose: iOS "Add to Home Screen" saves the current URL, and a home-screen
// app has its own storage, so the icon has to carry the token to sync.
(function captureToken() {
  try {
    const k = new URLSearchParams(location.search).get("k");
    if (k) localStorage.setItem(TOKEN_KEY, k);
  } catch { /* no window (tests) / private mode */ }
})();

let tokenP = null;
function syncToken() {
  return (tokenP ||= (async () => {
    try {
      const t = localStorage.getItem(TOKEN_KEY);
      if (t) return t;
    } catch { /* private mode */ }
    if (!HAS_SERVER) return null;
    try { // the Mac server knows it
      const res = await fetch("/api/sync-token", { cache: "no-store" });
      if (res.ok) {
        const t = (await res.json()).token;
        if (t) {
          try { localStorage.setItem(TOKEN_KEY, t); } catch { /* private mode */ }
          return t;
        }
      }
    } catch { /* offline */ }
    return null;
  })());
}

/** Turn sync on from a pasted token or sync link; true when the cloud accepts it. */
export async function enableSync(input) {
  const text = String(input || "").trim();
  const token = (text.match(/[?&]k=([0-9a-f]+)/i) || [])[1] || text;
  if (!/^[0-9a-f]{16,}$/i.test(token)) return false;
  try {
    await rpc("dl_exam_progress_get", { p_token: token, p_name: "written" });
  } catch {
    return false; // wrong token (or offline)
  }
  try { localStorage.setItem(TOKEN_KEY, token); } catch { return false; }
  tokenP = null;
  return true;
}

async function rpc(fn, args) {
  const body = JSON.stringify(args);
  const res = await fetch(CLOUD_RPC + fn, {
    method: "POST", headers: { apikey: CLOUD_KEY, "Content-Type": "application/json" }, body,
    keepalive: body.length < 60000, cache: "no-store",
  });
  if (!res.ok) throw new Error(`${fn}: HTTP ${res.status}`);
  return res.json();
}

/** {data, saved_at} or null; throws when the cloud is unreachable or the token is wrong. */
async function cloudGet(name) {
  const token = await syncToken();
  if (!token) return null;
  try {
    const r = await rpc("dl_exam_progress_get", { p_token: token, p_name: name });
    cloud.status = "ok";
    cloud.at = Date.now();
    return r;
  } catch (err) {
    cloud.status = "error";
    throw err;
  }
}

const latest = {};
const inflight = {};
let reloading = false;
/** Upload the newest copy; one request at a time per name so our own saves never look like a conflict. */
function cloudPush(name, data) {
  latest[name] = data;
  if (inflight[name]) return inflight[name];
  inflight[name] = (async () => {
    try {
      const token = await syncToken();
      if (!token) return;
      while (latest[name]) {
        const d = latest[name];
        latest[name] = null;
        const r = await rpc("dl_exam_progress_put", {
          p_token: token, p_name: name, p_data: d, p_saved_at: stamp(d), p_base: cloud.base[name] || 0,
        });
        cloud.status = "ok";
        cloud.at = Date.now();
        if (r?.ok) cloud.base[name] = r.saved_at;
        else { await adoptCloud(name); return; } // another device saved after this tab last synced
      }
    } catch {
      cloud.status = "error"; // the next save sends the whole state again
    } finally {
      inflight[name] = null;
    }
  })();
  return inflight[name];
}

/** Another device's save is newer than what this tab started from: keep that one (this tab's last
 *  answer is dropped) by copying it over the browser and server copies, then restart from it. */
async function adoptCloud(name) {
  if (reloading) return;
  reloading = true;
  for (const n of Object.keys(pending)) clearTimeout(pending[n]);
  try {
    const r = await cloudGet(name);
    if (r?.data) {
      try { localStorage.setItem(`${LS_PREFIX}${name}`, JSON.stringify(r.data)); } catch { /* quota */ }
      await saveServer(name, r.data);
    }
  } catch { /* offline: the reload still compares all copies */ }
  location.reload();
}

const watched = new Set();
/** Coming back to this tab: if another device saved since, reload so we continue from its progress. */
function watchCloud(name) {
  if (watched.has(name) || typeof document === "undefined") return;
  watched.add(name);
  document.addEventListener("visibilitychange", async () => {
    if (document.visibilityState === "hidden") { flushSaves(); return; }
    try {
      const r = await cloudGet(name);
      if (r && r.saved_at > (cloud.base[name] || 0) && !latest[name] && !inflight[name] && !reloading) {
        reloading = true;
        location.reload();
      }
    } catch { /* offline: keep going locally */ }
  });
}

/** Newest of several copies (null when all are empty). */
function newest(...copies) {
  return copies.reduce((best, c) => (c && stamp(c) > stamp(best) ? c : best), null);
}

/** Server file, browser copy and cloud copy are all kept; the newest wins and is written back to the
 *  others, so progress made on another device (or while the server was down) is never overwritten. */
export async function loadProgress(name) {
  let server = null;
  let serverUp = false;
  if (HAS_SERVER) try {
    const res = await fetch(`/api/progress/${name}`, { cache: "no-store" });
    if (res.ok) { server = (await res.json()).data; serverUp = true; }
  } catch { /* server down: fall back to the browser copy */ }
  let local = null;
  try {
    const raw = localStorage.getItem(`${LS_PREFIX}${name}`);
    local = raw ? JSON.parse(raw) : null;
  } catch { /* private mode / bad JSON */ }
  let remote = null;
  try { remote = await cloudGet(name); } catch { /* offline */ }
  if (remote) cloud.base[name] = remote.saved_at;
  watchCloud(name);

  const best = newest(server, local, remote?.data);
  if (!best) return null;
  if (serverUp && best !== server) saveServer(name, best);
  if (best !== local) {
    try { localStorage.setItem(`${LS_PREFIX}${name}`, JSON.stringify(best)); } catch { /* quota */ }
  }
  if (stamp(best) > (remote?.saved_at || 0)) cloudPush(name, best);
  return best;
}

function saveServer(name, data) {
  if (!HAS_SERVER) return Promise.resolve();
  const body = JSON.stringify({ data });
  // keepalive lets a save started while the tab closes finish; browsers cap it at 64 KB
  return fetch(`/api/progress/${name}`, {
    method: "PUT", headers: { "Content-Type": "application/json" }, body, keepalive: body.length < 60000,
  }).catch(() => {});
}

const pending = {};
const sends = {};
function flushSaves() {
  for (const name of Object.keys(pending)) {
    clearTimeout(pending[name]);
    delete pending[name];
    sends[name]?.();
  }
}

export function saveProgress(name, data, { immediate = false, keepStamp = false } = {}) {
  if (reloading) return; // adoptCloud is replacing this tab's state
  if (data && typeof data === "object" && !keepStamp) data._savedAt = Date.now();
  try { localStorage.setItem(`${LS_PREFIX}${name}`, JSON.stringify(data)); } catch { /* quota/private mode */ }
  clearTimeout(pending[name]);
  const send = (sends[name] = () => Promise.all([saveServer(name, data), cloudPush(name, data)]));
  if (immediate) return send();
  pending[name] = setTimeout(() => { delete pending[name]; send(); }, 400);
}

export async function loadJSON(url) {
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
  return res.json();
}

// ---- static build (GitHub Pages): no server.py ----
export const ROOT = new URL("../", import.meta.url).href;
