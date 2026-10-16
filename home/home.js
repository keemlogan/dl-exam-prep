import { ROOT } from "../common/api.js";
// Home: D-day, greeting, 시험 분석, 추천 학습 (continue), entry cards. Numbers come from the same functions
// the trainer uses (engine.summarize), so both pages agree.
import { cloud, dDay, enableSync } from "../common/api.js";
import { masteryOf, summarize, wrongList } from "../written/engine.js";
import { shortTitle } from "../written/render.js";
import { loadBank, loadSaved } from "../written/store.js";

const $ = (id) => document.getElementById(id);
const pct = (x) => `${Math.round((x || 0) * 100)}%`;
const fmt = (x) => String(Math.round(x * 10) / 10);

function greeting(d) {
  if (d > 1) return `시험까지 ${d}일 남았어요`;
  if (d === 1) return "내일이 시험이에요";
  if (d === 0) return "오늘이 시험이에요. 차분하게 가요";
  return "시험 보느라 수고 많았어요";
}

function setContinue(title, desc, href) {
  $("continue-title").textContent = title;
  $("continue-desc").textContent = desc;
  if (href) $("continue").href = href;
}

/** Cloud sync state from common/api.js, so it is clear whether progress follows to the other device.
 *  When it is off (e.g. a new home-screen icon), the sync link or token can be pasted right here. */
function showSync() {
  const el = $("sync");
  el.hidden = false;
  el.classList.toggle("is-off", cloud.status !== "ok");
  if (cloud.status === "ok") {
    el.textContent = "진도가 맥·휴대폰 어디서 풀든 함께 저장돼요";
    return;
  }
  el.textContent = cloud.status === "error"
    ? "지금은 동기화 서버에 연결되지 않아 이 기기에만 저장 중이에요 (연결되면 다시 올라가요)"
    : "이 기기는 동기화가 꺼져 있어요 · 동기화 링크나 키를 붙여 넣어 켜 주세요";
  if (cloud.status === "error") return;
  const form = document.createElement("form");
  form.className = "sync-form";
  form.innerHTML = '<input id="sync-input" type="text" inputmode="url" autocomplete="off" autocapitalize="off" ' +
    'spellcheck="false" placeholder="https://…?k=… 또는 키" aria-label="동기화 링크 또는 키">' +
    '<button type="submit">켜기</button>';
  const msg = document.createElement("span");
  msg.className = "sync-msg";
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    msg.textContent = "확인 중…";
    if (await enableSync($("sync-input").value)) {
      msg.textContent = "켜졌어요. 진도를 불러올게요";
      location.reload();
    } else {
      msg.textContent = "키가 맞지 않아요. 링크 전체를 다시 붙여 넣어 주세요";
    }
  });
  el.append(form, msg);
}

async function main() {
  const d = dDay();
  $("dday").textContent = d > 0 ? `D-${d}` : d === 0 ? "D-DAY" : `D+${-d}`;
  $("dday").hidden = false;
  $("greet").textContent = greeting(d);

  let B;
  try {
    B = await loadBank();
  } catch {
    return; // no bank at all: the static cards still work
  }
  const S = await loadSaved().catch(() => null);
  showSync();
  if (!S) return;
  const { bank } = B;
  const sum = summarize(S.engine, bank.concepts, bank);

  $("w-pct").textContent = pct(sum.overall);
  $("w-fill").style.width = pct(sum.overall);
  $("w-fill2").style.width = pct(sum.overall);
  $("w-meter").setAttribute("aria-label", `전체 숙련도 ${pct(sum.overall)}`);
  $("w-foot").textContent = sum.answered ? `완료 ${sum.mastered}/${sum.total} 개념 · 푼 문제 ${sum.answered}` : `완료 ${sum.mastered}/${sum.total} 개념`;
  document.querySelector(".entry .entry-title").textContent = `${sum.total}개 개념 중 하나만`;

  const wrongN = wrongList(S.engine).filter((w) => bank.byId.has(w.qid)).length;
  $("r-sub").textContent = wrongN ? `틀린 문제 ${wrongN}개를 다시 풀어요` : "아직 틀린 문제가 없어요";
  if (sum.answered) $("s-sub").textContent = `푼 문제 ${sum.answered} · 정답률 ${pct(sum.accuracy)}`;

  const mock = S.mock;
  if (mock?.done && mock.max) {
    $("m-num").textContent = fmt(mock.total);
    $("m-unit").textContent = `/ ${fmt(mock.max)}점 · 최근`;
    $("m-fill").style.width = pct(mock.total / mock.max);
    $("m-meter").setAttribute("aria-label", `최근 모의고사 ${fmt(mock.total)}점`);
  } else if (mock && !mock.done) {
    $("m-num").textContent = "진행 중";
    $("m-unit").textContent = "";
  }

  const left = sum.total - sum.mastered;
  $("greet-sub").textContent = !sum.answered
    ? "시험 분석을 먼저 훑고, 추천 학습으로 가볍게 시작해 봐요."
    : left > 0
      ? `${left}개 개념만 더 채우면 돼요. 모의고사로 120분 감각도 익혀 봐요.`
      : "모든 개념을 채웠어요. 모의고사로 실전 감각을 유지해요.";

  const byId = bank.conceptById;
  const ses = S.session;
  if (mock && !mock.done && !mock.submitted && mock.endsAt > Date.now()) {
    const answered = Object.keys(mock.answers || {}).length;
    const mins = Math.ceil((mock.endsAt - Date.now()) / 60000);
    setContinue("모의고사 이어서 풀기", `남은 시간 ${mins}분 · ${answered}/${mock.items.length}문제 답함`, ROOT+"written/#/mock");
  } else if (ses && ses.qid && (ses.kind === "learn" || ses.kind === "practice")) {
    const cid = ses.kind === "practice" ? ses.cid : S.engine.focus?.cid || bank.byId.get(ses.qid)?.concept;
    const c = byId[cid];
    const title = c ? `‘${shortTitle(c.title_ko)}’ 이어서 풀기` : "추천 학습 이어서 하기";
    const href = ses.kind === "practice" ? `${ROOT}written/#/practice/${encodeURIComponent(cid)}` : ROOT+"written/#/learn";
    setContinue(title, `숙련도 ${pct(masteryOf(S.engine, cid, bank))} · 풀던 문제부터 바로 이어져요`, href);
  } else if (sum.answered) {
    const c = byId[S.engine.focus?.cid];
    setContinue("추천 학습 이어서 하기", c ? `지금 ‘${shortTitle(c.title_ko)}’ 연습 중이에요 · 완료 ${sum.mastered}/${sum.total}`
      : `완료 ${sum.mastered}/${sum.total} · 약한 개념부터 골라 드릴게요`);
  }
}

main();
