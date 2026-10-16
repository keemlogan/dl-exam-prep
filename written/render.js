// Pure rendering helpers: a small Python highlighter, markdown-lite with KaTeX math and tables, slide-ref
// links, and display labels. Returns HTML strings (no DOM). Math uses `globalThis.katex` when it is loaded
// (web/vendor/katex); without it (node tests, a failed load) the TeX source is shown escaped.

export function esc(s) {
  return String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

// ---- Python highlighter -------------------------------------------------------------------------------

const KEYWORDS = new Set(("False None True and as assert async await break class continue def del elif else except " +
  "finally for from global if import in is lambda nonlocal not or pass raise return try while with yield").split(" "));
const BUILTINS = new Set(("print len range sum min max abs round int float str bool list dict tuple set zip enumerate " +
  "isinstance type super map filter sorted reversed any all iter next open format repr hasattr getattr setattr " +
  "self").split(" "));
const LIBS = new Set(["torch", "nn", "F", "np", "math", "optim", "torchvision", "transforms", "numpy", "random"]);
const NUMBER = /^(?:0[xX][0-9a-fA-F_]+|0[bB][01_]+|(?:\d[\d_]*\.?[\d_]*|\.\d[\d_]*)(?:[eE][+-]?\d+)?j?)/;

function push(out, t, v) {
  if (!v) return;
  const last = out[out.length - 1];
  if (last && last.t === t) last.v += v;
  else out.push({ t, v });
}

/** Scan a string body from `i` until `quote` closes it (or the line ends). Sets `st.tri` for open triple quotes. */
function scanString(line, i, st, out, quote) {
  while (i < line.length) {
    if (line.startsWith(quote, i)) {
      push(out, "str", quote);
      if (quote.length === 3) st.tri = null;
      return i + quote.length;
    }
    if (line[i] === "\\") {
      push(out, "esc", line.slice(i, i + 2));
      i += 2;
      continue;
    }
    push(out, "str", line[i]);
    i++;
  }
  if (quote.length === 3) st.tri = quote;
  return i;
}

function scan(line, st, out) {
  let i = 0;
  let prevWord = "";
  if (st.tri) i = scanString(line, 0, st, out, st.tri);
  while (i < line.length) {
    const rest = line.slice(i);
    const ch = line[i];
    if (ch === "#") return push(out, "com", rest);
    const sm = /^([rRbBuUfF]{0,2})("""|'''|"|')/.exec(rest);
    if (sm && (sm[1] === "" || !/[\w]/.test(line[i - 1] || ""))) {
      push(out, "str", sm[0]);
      i = scanString(line, i + sm[0].length, st, out, sm[2]);
      continue;
    }
    if (ch === "@" && /^@[A-Za-z_][\w.]*/.test(rest) && !line.slice(0, i).trim()) {
      const m = /^@[A-Za-z_][\w.]*/.exec(rest);
      push(out, "dec", m[0]);
      i += m[0].length;
      continue;
    }
    const num = NUMBER.exec(rest);
    if (num && /[\d.]/.test(ch) && !/[\w]/.test(line[i - 1] || "") && num[0] !== ".") {
      push(out, "num", num[0]);
      i += num[0].length;
      continue;
    }
    const id = /^[A-Za-z_]\w*/.exec(rest);
    if (id) {
      const w = id[0];
      const after = line.slice(i + w.length);
      const isAttr = line[i - 1] === ".";
      let t = "plain";
      if (KEYWORDS.has(w) && !isAttr) t = "kw";
      else if (prevWord === "def" || prevWord === "class") t = "fn";
      else if (!isAttr && LIBS.has(w)) t = "lib";
      else if (!isAttr && BUILTINS.has(w)) t = "bi";
      else if (/^\s*\(/.test(after)) t = "fn";
      push(out, t, w);
      i += w.length;
      prevWord = w;
      continue;
    }
    push(out, "plain", ch);
    if (!/\s/.test(ch)) prevWord = "";
    i++;
  }
}

/** Tokens per line: `[{t: "kw"|"str"|"esc"|"num"|"com"|"fn"|"bi"|"lib"|"dec"|"plain", v}]`. */
export function tokenizeLines(lines) {
  const st = { tri: null };
  return lines.map((line) => {
    const out = [];
    scan(line, st, out);
    return out;
  });
}

export function tokensToHtml(tokens) {
  return tokens.map((t) => (t.t === "plain" ? esc(t.v) : `<span class="k-${t.t}">${esc(t.v)}</span>`)).join("");
}

export function highlightLine(line) {
  return tokensToHtml(tokenizeLines([line])[0]);
}

/** Lines of a code string (trailing newlines dropped). */
export function codeLines(code) {
  const s = String(code ?? "").replace(/\s+$/, "");
  return s ? s.split("\n") : [];
}

/** Numbered, highlighted code. `marks` = {lineNo: "hl"|"bad"|"good"}. */
export function codeHtml(lines, { marks = {} } = {}) {
  const toks = tokenizeLines(lines);
  const rows = lines.map((_, i) => {
    const mark = marks[i + 1] ? ` cl-${marks[i + 1]}` : "";
    return `<div class="cl${mark}"><span class="cl-no" aria-hidden="true">${i + 1}</span>` +
      `<span class="cl-tx">${tokensToHtml(toks[i]) || " "}</span></div>`;
  });
  return `<div class="code-lines">${rows.join("")}</div>`;
}

// ---- math ---------------------------------------------------------------------------------------------

/** TeX → HTML via KaTeX (never throws); escaped source when KaTeX is not loaded. */
export function texHtml(tex, display = false) {
  const k = globalThis.katex;
  if (k && typeof k.renderToString === "function") {
    try {
      return k.renderToString(tex, { displayMode: display, throwOnError: false, strict: "ignore", output: "html" });
    } catch { /* fall through */ }
  }
  return `<span class="math-raw">${esc(display ? `$$${tex}$$` : `$${tex}$`)}</span>`;
}

/**
 * Split text into math and plain parts: `$$…$$` (display) and `$…$` (inline: the opening `$` is not followed by
 * a space, the closing `$` is not preceded by a space nor followed by a digit). `\$` is a literal dollar.
 */
export function splitMath(text) {
  const s = String(text ?? "");
  const out = [];
  let buf = "";
  let i = 0;
  while (i < s.length) {
    if (s[i] === "\\" && s[i + 1] === "$") { buf += "$"; i += 2; continue; }
    if (s[i] === "$") {
      if (s[i + 1] === "$") {
        const end = s.indexOf("$$", i + 2);
        if (end > i + 2) {
          if (buf) out.push({ t: "text", v: buf });
          buf = "";
          out.push({ t: "math", v: s.slice(i + 2, end).trim(), display: true });
          i = end + 2;
          continue;
        }
      } else if (s[i + 1] && !/\s/.test(s[i + 1])) {
        let j = i + 1;
        let found = -1;
        while (j < s.length && s[j] !== "\n") {
          if (s[j] === "\\") { j += 2; continue; }
          if (s[j] === "$") {
            if (!/\s/.test(s[j - 1]) && !/\d/.test(s[j + 1] || "")) { found = j; break; }
          }
          j++;
        }
        if (found > 0) {
          if (buf) out.push({ t: "text", v: buf });
          buf = "";
          out.push({ t: "math", v: s.slice(i + 1, found), display: false });
          i = found + 1;
          continue;
        }
      }
    }
    buf += s[i];
    i++;
  }
  if (buf) out.push({ t: "text", v: buf });
  return out;
}

// ---- slide refs in text -------------------------------------------------------------------------------

const PAGES = String.raw`p\.\s*\d+(?:\s*[–-]\s*\d+)?`;
const REF_RE = new RegExp(String.raw`lec\d{2}-\d(?:\s+|\s*·\s*)${PAGES}(?:\s*,\s*${PAGES})*`, "g");

/** Wrap slide citations ("lec07-1 p.23", "lec04-2 p.24–26, p.30") in buttons the slide viewer listens for. */
function linkRefs(html) {
  return html.replace(REF_RE, (m) => `<button type="button" class="slide-link" data-ref="${esc(m)}">${m}</button>`);
}

// ---- markdown-lite --------------------------------------------------------------------------------------

const SLOT = "\u0000";

/**
 * Inline markdown: `code`, $math$, **bold**, slide refs. Code spans are taken out first (so a `$` inside code
 * is never math), then math (so `*` inside TeX is never bold); everything else is escaped.
 */
export function mdInline(text, { refs = true } = {}) {
  const slots = [];
  const keep = (html) => `${SLOT}${slots.push(html) - 1}${SLOT}`;
  const parts = String(text ?? "").split(/(`[^`\n]+`)/g).map((part) => {
    if (part.length > 1 && part.startsWith("`") && part.endsWith("`")) return keep(`<code>${esc(part.slice(1, -1))}</code>`);
    return splitMath(part).map((p) => (p.t === "math" ? keep(texHtml(p.v, p.display)) : p.v.replace(/\u0000/g, ""))).join("");
  }).join("");
  let html = esc(parts).replace(/\*\*([^*\n]+?)\*\*/g, "<strong>$1</strong>");
  if (refs) html = linkRefs(html);
  return html.replace(new RegExp(`${SLOT}(\\d+)${SLOT}`, "g"), (_, n) => slots[Number(n)]);
}

/** Split a table row on `|` that are not inside `code` or $math$. */
function splitRow(line) {
  let s = line.trim();
  if (s.startsWith("|")) s = s.slice(1);
  if (s.endsWith("|") && !s.endsWith("\\|")) s = s.slice(0, -1);
  const cells = [];
  let cur = "";
  let inCode = false;
  let inMath = false;
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (ch === "\\" && s[i + 1] === "|") { cur += "|"; i++; continue; }
    if (ch === "`" && !inMath) inCode = !inCode;
    else if (ch === "$" && !inCode) inMath = !inMath;
    if (ch === "|" && !inCode && !inMath) { cells.push(cur.trim()); cur = ""; continue; }
    cur += ch;
  }
  cells.push(cur.trim());
  return cells;
}

const isTableLine = (l) => /^\s*\|.*\|\s*$/.test(l);
const isSepRow = (l) => /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/.test(l);

function tableHtml(rows) {
  let head = null;
  let align = [];
  let body = rows;
  if (rows.length >= 2 && isSepRow(rows[1])) {
    head = splitRow(rows[0]);
    align = splitRow(rows[1]).map((c) => (c.startsWith(":") && c.endsWith(":") ? "center" : c.endsWith(":") ? "right" : ""));
    body = rows.slice(2);
  }
  const cell = (tag, c, k) => `<${tag}${align[k] ? ` style="text-align:${align[k]}"` : ""}>${mdInline(c)}</${tag}>`;
  const thead = head ? `<thead><tr>${head.map((c, k) => cell("th", c, k)).join("")}</tr></thead>` : "";
  const tbody = `<tbody>${body.map((r) => `<tr>${splitRow(r).map((c, k) => cell("td", c, k)).join("")}</tr>`).join("")}</tbody>`;
  return `<div class="md-table"><table>${thead}${tbody}</table></div>`;
}

/**
 * Markdown-lite for explanations, cards, given tables and the guide: `code`, **bold**, $math$, $$display$$,
 * newlines (→ <br>), "- " bullets, "1. " numbered lists, `| a | b |` tables, "#" headings, ``` fenced code
 * (Python-highlighted, never math). Escapes everything else. Render into a block element.
 */
export function mdLite(text) {
  const lines = String(text ?? "").replace(/\r\n?/g, "\n").split("\n");
  let html = "";
  let list = null; // {tag, items}
  let afterText = false;
  const flush = () => {
    if (list) html += `<${list.tag}${list.start > 1 ? ` start="${list.start}"` : ""}>${list.items.join("")}</${list.tag}>`;
    list = null;
  };
  const block = (b) => {
    flush();
    html += b;
    afterText = false;
  };
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const fence = /^\s*```\s*([\w+-]*)\s*$/.exec(line);
    if (fence) {
      const body = [];
      for (i++; i < lines.length && !/^\s*```\s*$/.test(lines[i]); i++) body.push(lines[i]);
      block(`<div class="code-card">${codeHtml(body)}</div>`);
      continue;
    }
    if (/^\s*\$\$/.test(line)) {
      const one = /^\s*\$\$(.+)\$\$\s*$/.exec(line);
      if (one) { block(`<div class="math-block">${texHtml(one[1].trim(), true)}</div>`); continue; }
      const body = [line.replace(/^\s*\$\$/, "")];
      let j = i + 1;
      for (; j < lines.length && !/\$\$\s*$/.test(lines[j]); j++) body.push(lines[j]);
      if (j < lines.length) {
        body.push(lines[j].replace(/\$\$\s*$/, ""));
        block(`<div class="math-block">${texHtml(body.join("\n").trim(), true)}</div>`);
        i = j;
        continue;
      }
    }
    if (isTableLine(line)) {
      const rows = [];
      for (; i < lines.length && isTableLine(lines[i]); i++) rows.push(lines[i]);
      i--;
      block(tableHtml(rows));
      continue;
    }
    const head = /^\s*(#{1,4})\s+(.*)$/.exec(line);
    if (head) {
      block(`<h${Math.min(6, head[1].length + 2)} class="md-h">${mdInline(head[2])}</h${Math.min(6, head[1].length + 2)}>`);
      continue;
    }
    const bullet = /^\s*[-*] (.*)$/.exec(line);
    const num = /^\s*(\d+)[.)] (.*)$/.exec(line);
    if (bullet || num) {
      const tag = bullet ? "ul" : "ol";
      if (list && list.tag !== tag) flush();
      list ||= { tag, items: [], start: num ? Number(num[1]) : 1 };
      list.items.push(`<li>${mdInline(bullet ? bullet[1] : num[2])}</li>`);
      continue;
    }
    if (list) {
      flush();
      afterText = false;
      if (!line.trim()) continue; // a blank line right after a list only ends it
    }
    html += (afterText ? "<br>" : "") + mdInline(line);
    afterText = true;
  }
  flush();
  return html;
}

/**
 * One term-definition line: `**용어**(English): 정의`, `**reshape**: …`, `**차원** $D$ (dimension): …`. After the bold
 * term, an optional gloss (parentheses and/or $math$, up to 80 chars) and then the first ":" outside math/parens.
 */
function termDef(line) {
  const m = /^\*\*([^*\n]+)\*\*/.exec(line);
  if (!m) return null;
  const rest = line.slice(m[0].length);
  let depth = 0;
  let math = false;
  for (let i = 0; i < rest.length && i <= 80; i++) {
    const ch = rest[i];
    if (ch === "$") math = !math;
    else if (!math && ch === "(") depth++;
    else if (!math && ch === ")") depth = Math.max(0, depth - 1);
    else if (!math && depth === 0 && ch === ":") {
      const gloss = rest.slice(0, i).trim();
      if (gloss && !/^(\(.*\)|\$.*\$)(\s*(\(.*\)|\$.*\$))*$/.test(gloss)) return null; // prose before the colon
      return { term: m[1].trim(), gloss, text: rest.slice(i + 1).replace(/^ /, "") };
    } else if (!math && depth === 0 && !/\s/.test(ch) && !rest.slice(0, i).trim() && ch !== "(" && ch !== "$") return null;
  }
  return null;
}

/**
 * Split the term-definition lines an explanation STARTS with from the rest. Only the leading run counts;
 * a definition-looking line later stays in `rest`. Returns `{defs: [{term, gloss, text}], rest}`.
 */
export function splitTermDefs(text) {
  const lines = String(text ?? "").split("\n");
  const defs = [];
  while (defs.length < lines.length) {
    const d = termDef(lines[defs.length]);
    if (!d) break;
    defs.push(d);
  }
  return { defs, rest: defs.length ? lines.slice(defs.length).join("\n").replace(/^\n+/, "") : String(text ?? "") };
}

/** The "먼저 알아둘 용어" box: one row per term (term bold, then its definition). */
export function termDefsHtml(defs) {
  if (!defs.length) return "";
  const rows = defs.map((d) => `<div class="term-row"><dt><strong>${mdInline(d.term, { refs: false })}</strong>` +
    `${d.gloss ? `<span class="term-gloss">${mdInline(d.gloss, { refs: false })}</span>` : ""}</dt><dd>${mdInline(d.text)}</dd></div>`);
  return `<div class="terms" role="note" aria-label="먼저 알아둘 용어"><p class="terms-title">먼저 알아둘 용어</p>` +
    `<dl class="terms-list">${rows.join("")}</dl></div>`;
}

// ---- labels -------------------------------------------------------------------------------------------

export const FORMAT_LABEL = {
  tf: { ko: "참/거짓", en: "True / False" },
  calc: { ko: "계산", en: "Calculation" },
  written: { ko: "서술형", en: "Short answer" },
  code: { ko: "PyTorch 코드", en: "PyTorch code" },
  concept: { ko: "개념 확인", en: "Concept check" },
};

export const TYPE_LABEL = {
  ox: "참/거짓", choice: "객관식", multi: "모두 고르기", numeric: "계산", steps: "단계별 계산", written: "서술형", output: "출력 쓰기",
};

export const LEVEL_LABEL = { 1: "기초", 2: "응용", 3: "실전" };

export const STATUS_LABEL = { mastered: "완료", learning: "연습 중", new: "아직" };

export const WEEKS = {
  1: "딥러닝 소개", 2: "머신러닝 기초 · 선형회귀", 3: "일반화 · 정규화 · 텐서", 4: "경사하강 · 역전파 · MLP",
  5: "PyTorch · 이진 분류 · 드롭아웃", 6: "옵티마이저 · 합성곱", 7: "CNN 실전 · 전이학습 · ResNet",
};

/** "합성곱 연산 손계산 (1D·2D·3D)" → "합성곱 연산 손계산" */
export function shortTitle(title) {
  return String(title ?? "").replace(/\s*\([^)]*\)\s*$/, "").trim() || String(title ?? "");
}

/** Week of the first lecture a ref names ("lec04-2 p.24" → 4), or null. */
export function refWeek(ref) {
  const m = /lec(\d{2})-\d/.exec(String(ref ?? ""));
  return m ? Number(m[1]) : null;
}

export function refLabel(ref) {
  const w = refWeek(ref);
  if (!ref) return "강의노트";
  return w ? `${ref} · 강의노트 ${w}주차` : String(ref);
}

export function pct(x) {
  return `${Math.round((x || 0) * 100)}%`;
}
