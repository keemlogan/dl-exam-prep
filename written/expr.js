// Safe arithmetic for numeric answers and the calculator sheet (no eval). Pure: no DOM.
//
// Accepts: numbers (-0.5, .5, 3., 1e-3, 2E+4), + − × ÷ * / ^ (also **), parentheses, unary ±, √x / √(x),
// functions sqrt exp ln log (= ln, as in PyTorch/NumPy) log10 log2 abs sin cos tan tanh, constants pi π e,
// and implicit multiplication (2pi, 2(3), (1+2)(3)). `^` is right-associative and binds tighter than unary
// minus: -2^2 = -4, 2^-1 = 0.5. Returns NaN for anything it cannot read or a non-finite result.

const FUNCS = {
  sqrt: Math.sqrt, exp: Math.exp, ln: Math.log, log: Math.log, log10: Math.log10, log2: Math.log2,
  abs: Math.abs, sin: Math.sin, cos: Math.cos, tan: Math.tan, tanh: Math.tanh,
};
const CONSTS = { pi: Math.PI, "π": Math.PI, e: Math.E };

/** Unicode operators → ASCII, `**` → `^`. */
export function normalizeExpr(src) {
  return String(src ?? "")
    .replace(/[−–—﹣－]/g, "-")
    .replace(/[×✕·∙⋅]/g, "*")
    .replace(/[÷∕]/g, "/")
    .replace(/\*\*/g, "^")
    .replace(/，/g, ",")
    .trim();
}

function tokenize(s) {
  const out = [];
  let i = 0;
  while (i < s.length) {
    const ch = s[i];
    if (/\s/.test(ch)) { i++; continue; }
    const num = /^(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?/.exec(s.slice(i));
    if (num) { out.push({ t: "num", v: Number(num[0]) }); i += num[0].length; continue; }
    const id = /^(?:[A-Za-z_][A-Za-z0-9_]*|π)/.exec(s.slice(i));
    if (id) { out.push({ t: "id", v: id[0].toLowerCase() }); i += id[0].length; continue; }
    if ("+-*/^()√".includes(ch)) { out.push({ t: ch }); i++; continue; }
    throw new Error(`bad char ${ch}`);
  }
  return out;
}

/** Evaluate an expression string; NaN when it is not a valid, finite expression. */
export function evalExpr(src) {
  const s = normalizeExpr(src);
  if (!s) return NaN;
  let toks;
  try { toks = tokenize(s); } catch { return NaN; }
  let k = 0;
  const peek = () => toks[k];
  const take = (t) => (toks[k] && toks[k].t === t ? toks[k++] : null);
  // implicit multiplication only before a name, "(" or "√" — two bare numbers in a row ("3 4", "1..2") are an error
  const startsAtom = (tk) => tk && (tk.t === "id" || tk.t === "(" || tk.t === "√");

  function expr() {
    let v = term();
    for (;;) {
      if (take("+")) v += term();
      else if (take("-")) v -= term();
      else return v;
    }
  }
  function term() {
    let v = unary();
    for (;;) {
      if (take("*")) v *= unary();
      else if (take("/")) v /= unary();
      else if (startsAtom(peek())) v *= power(); // implicit multiplication: 2pi, 2(3), (a)(b)
      else return v;
    }
  }
  function unary() {
    if (take("-")) return -unary();
    if (take("+")) return unary();
    return power();
  }
  function power() {
    const base = atom();
    if (take("^")) return base ** unary();
    return base;
  }
  function atom() {
    const tk = toks[k++];
    if (!tk) throw new Error("end");
    if (tk.t === "num") return tk.v;
    if (tk.t === "(") {
      const v = expr();
      if (!take(")")) throw new Error("missing )");
      return v;
    }
    if (tk.t === "√") return Math.sqrt(power());
    if (tk.t === "id") {
      if (Object.hasOwn(FUNCS, tk.v)) {
        if (!take("(")) throw new Error("function needs (");
        const v = expr();
        if (!take(")")) throw new Error("missing )");
        return FUNCS[tk.v](v);
      }
      if (Object.hasOwn(CONSTS, tk.v)) return CONSTS[tk.v];
    }
    throw new Error("unexpected token");
  }

  try {
    const v = expr();
    if (k !== toks.length) return NaN;
    return Number.isFinite(v) ? v : NaN;
  } catch {
    return NaN;
  }
}

/** True when the text is just a number (so the UI need not show "= value"). */
export function isPlainNumber(src) {
  return /^[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?$/.test(normalizeExpr(src));
}

/** Short display of a computed value: up to 6 significant digits, no trailing zeros. */
export function fmtNum(v, digits = 6) {
  if (!Number.isFinite(v)) return "–";
  if (v === 0) return "0";
  const r = Number(v.toPrecision(digits));
  const abs = Math.abs(r);
  if (abs >= 1e-4 && abs < 1e9) return String(r);
  return r.toExponential().replace(/\.?0+e/, "e");
}
