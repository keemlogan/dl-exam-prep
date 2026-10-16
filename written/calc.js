// Calculator sheet for numeric / steps questions (the exam allows a basic/scientific calculator).
// Keys: digits, + − × ÷, ^, √, ( ), exp, ln, ±, C, ⌫, =. The result can be put into the field that had focus.
// Evaluation goes through expr.js (no eval). The expression survives closing the sheet (this page only).
import { evalExpr, fmtNum } from "./expr.js";
import { btn, h, openSheet } from "./ui.js";

let memory = "";      // expression shown when the sheet opens again
let lastAns = null;   // value of the last "="

const KEYS = [
  ["C", "clear", "fn"], ["(", "("], [")", ")"], ["⌫", "back", "fn"],
  ["exp", "exp(", "fn"], ["ln", "ln(", "fn"], ["√", "sqrt(", "fn"], ["^", "^", "op"],
  ["7", "7"], ["8", "8"], ["9", "9"], ["÷", "÷", "op"],
  ["4", "4"], ["5", "5"], ["6", "6"], ["×", "×", "op"],
  ["1", "1"], ["2", "2"], ["3", "3"], ["−", "−", "op"],
  ["0", "0"], [".", "."], ["±", "neg", "fn"], ["+", "+", "op"],
];

/** Toggle the sign of the last number (or of the whole expression if it ends in ")"). */
function negate(s) {
  const m = /(.*?)([−-]?)(\d*\.?\d+(?:e[+-]?\d+)?|\d+\.)$/i.exec(s);
  if (m) return m[2] ? m[1] + m[3] : `${m[1]}−${m[3]}`;
  if (!s) return "−";
  return /^−\(.*\)$/.test(s) ? s.slice(2, -1) : `−(${s})`;
}

/**
 * Open the calculator. `target` = the input to fill (optional); `onInsert(valueString)` is called with the
 * result when the student taps "결과 넣기".
 */
export function openCalculator({ target = null, label = "", onInsert } = {}) {
  const input = h("input", { class: "calc-in", type: "text", inputmode: "none", autocomplete: "off", autocapitalize: "off",
    spellcheck: "false", "aria-label": "계산식", value: memory });
  const result = h("output", { class: "calc-out", "aria-live": "polite" });
  const update = () => {
    memory = input.value;
    const v = evalExpr(input.value);
    result.textContent = input.value.trim() ? (Number.isFinite(v) ? `= ${fmtNum(v, 10)}` : "식을 끝까지 써 주세요") : " ";
    result.classList.toggle("is-bad", !!input.value.trim() && !Number.isFinite(v));
    insertBtn.disabled = !Number.isFinite(v);
  };
  const typeText = (t) => {
    const a = input.selectionStart ?? input.value.length;
    const b = input.selectionEnd ?? input.value.length;
    input.value = input.value.slice(0, a) + t + input.value.slice(b);
    const at = a + t.length;
    input.setSelectionRange?.(at, at);
    update();
  };
  const equals = () => {
    const v = evalExpr(input.value);
    if (!Number.isFinite(v)) return;
    lastAns = v;
    input.value = fmtNum(v, 10).replace("-", "−");
    update();
  };
  const press = (val) => {
    if (val === "clear") { input.value = ""; update(); }
    else if (val === "back") {
      const a = input.selectionStart ?? input.value.length;
      const b = input.selectionEnd ?? input.value.length;
      if (a !== b) input.value = input.value.slice(0, a) + input.value.slice(b);
      else if (a > 0) { input.value = input.value.slice(0, a - 1) + input.value.slice(a); input.setSelectionRange?.(a - 1, a - 1); }
      update();
    } else if (val === "neg") { input.value = negate(input.value); update(); }
    else typeText(val);
  };
  const pad = h("div", { class: "calc-pad" }, KEYS.map(([text, val, kind]) => {
    const b = h("button", { type: "button", class: `calc-key${kind ? ` is-${kind}` : ""}`, "aria-label": val === "back" ? "지우기" : val === "clear" ? "모두 지우기" : val === "neg" ? "부호 바꾸기" : text }, text);
    b.addEventListener("pointerdown", (e) => e.preventDefault()); // keep the caret in the input
    b.addEventListener("click", () => press(val));
    return b;
  }));
  const eq = h("button", { type: "button", class: "calc-key is-eq", "aria-label": "계산" }, "=");
  eq.addEventListener("pointerdown", (e) => e.preventDefault());
  eq.addEventListener("click", equals);
  const ans = h("button", { type: "button", class: "calc-key is-fn", "aria-label": "직전 결과" }, "Ans");
  ans.addEventListener("pointerdown", (e) => e.preventDefault());
  ans.addEventListener("click", () => { if (lastAns != null) typeText(`(${fmtNum(lastAns, 10)})`); });

  const insertBtn = btn(target ? "결과 넣기" : "닫기", {
    onClick: () => {
      const v = evalExpr(input.value);
      if (target && Number.isFinite(v)) {
        onInsert?.(fmtNum(v, 10));
        sheet.close("insert");
        target.focus({ preventScroll: true });
      } else sheet.close("button");
    },
  });
  const closeBtn = btn("닫기", { kind: "secondary", cls: "is-narrow", onClick: () => sheet.close("button") });

  const sheet = openSheet(h("div", { class: "sheet-body calc" },
    h("div", { class: "calc-head" }, h("h2", { class: "sheet-title" }, "계산기"),
      label ? h("span", { class: "calc-for" }, `${label} 칸에 넣어요`) : null),
    h("div", { class: "calc-screen" }, input, result),
    pad, h("div", { class: "calc-row" }, ans, eq),
    h("p", { class: "hint" }, "키보드로 써도 돼요 · Enter = 계산 · log는 자연로그(ln)예요"),
    h("div", { class: "sheet-cta" }, target ? closeBtn : null, insertBtn)), { label: "계산기", className: "calc-sheet" });

  input.addEventListener("input", update);
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      e.stopPropagation();
      const v = evalExpr(input.value);
      if (Number.isFinite(v) && fmtNum(v, 10).replace("-", "−") === input.value && target) insertBtn.click();
      else equals();
    } else if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      sheet.close("esc");
    }
  });
  update();
  requestAnimationFrame(() => {
    input.focus({ preventScroll: true });
    input.setSelectionRange?.(input.value.length, input.value.length);
  });
  return sheet;
}
