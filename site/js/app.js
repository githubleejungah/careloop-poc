// 화면 연결. 규칙은 하네스 모듈에, 화면은 여기에만 둔다.
import { createStore } from "./store.js";
import { createClock, fmt, DAY, kst } from "./clock.js";
import * as A from "./agent.js";
import * as SCH from "./scheduler.js";
import { applyActions, send, addTask } from "./channels.js";
import * as LOG from "./log.js";
import { analyze } from "./policywatch.js";
import { runGolden } from "./golden.js";
import { CLASS_LABEL } from "./classifier.js";
import * as V from "./voice.js";
import * as TK from "./tasks.js";

const $ = (s) => document.querySelector(s);
const esc = (t) => String(t ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
const load = (n) => fetch(`data/${n}.json`, { cache: "no-cache" }).then((r) => r.json()); // 데이터도 늘 최신으로

const [rules, policy, hol, seed, golden, samplesDoc, pronounce] = await Promise.all(
  ["rules", "policy", "holidays", "seed", "golden_set", "policy_samples", "pronounce"].map(load));
V.setDictionary(pronounce.words);
const holidays = hol.dates;
const people = seed.people;
const store = createStore();
const clock = createClock(store);
const P = (id) => people.find((p) => p.id === id);
const KIND = { recheck_3m: "3개월 재검사", checkup_6m: "6개월 점검", grade_out: "등급외 상담" };

if (!store.get("init")) {
  const o = seed.orders[0];
  store.set("schedules", [SCH.createSchedule({ person_id: o.person_id, kind: "checkup_6m", base_date: kst(o.delivered_at), slot: "weekday_evening" }, holidays)]);
  // 6개월 점검 동의 때 사업소 전달 동의도 함께 받았다고 본다(Q19 · L-13)
  store.set("consents", [{ person_id: o.person_id, type: "checkup_6m", granted_at: o.delivered_at },
    { person_id: o.person_id, type: "provider_share", granted_at: o.delivered_at }]);
  store.set("init", true);
}

// ── 고객 화면 ──
let session = null; let person = P("P-01"); let activeSchedule = null;
const liveRules = () => ({ ...rules, pending_policy_topics: store.get("pending_topics", []) });
const ctxFor = () => ({ rules: liveRules(), policy, holidays, people, now: clock.now(), person,
  isElder: $("#is-elder").checked, order: seed.orders.find((o) => o.person_id === person.id),
  providerConsent: store.get("consents", []).some((c) => c.person_id === person.id && c.type === "provider_share" && !c.withdrawn_at) });

function addMsg(who, text) {
  const d = document.createElement("div");
  d.className = text.startsWith("출처:") ? "msg source" : `msg ${who}`;
  d.textContent = text;
  $("#chat").append(d); $("#chat").scrollTop = $("#chat").scrollHeight;
}
// 사람처럼 한 줄씩 보낸다: 줄 사이에 짧은 쉼, 그 사이 "입력 중…" 표시. 출처 줄은 바로 붙인다.
let renderQueue = Promise.resolve();
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
function render(o) {
  const box = $("#choices"); box.innerHTML = "";
  renderQueue = renderQueue.then(async () => {
    for (const line of o.say) {
      if (!line.startsWith("출처:")) {
        const typing = document.createElement("div"); typing.className = "msg ai typing"; typing.textContent = "입력 중…";
        $("#chat").append(typing); $("#chat").scrollTop = $("#chat").scrollHeight;
        await wait(Math.min(900, 250 + line.length * 12));
        typing.remove();
      }
      addMsg("ai", line);
      if (session?.channel === "voice") V.speak(line);
    }
    for (const c of o.choices ?? []) {
      const b = document.createElement("button"); b.type = "button"; b.textContent = c;
      b.onclick = () => sendText(c); box.append(b);
    }
  });
}
function showChat(title) { $("#screen-result").classList.add("hidden"); $("#screen-chat").classList.remove("hidden"); $("#phone-title").textContent = title; $("#chat").innerHTML = ""; }
function showResult() { V.stopSpeaking(); $("#screen-chat").classList.add("hidden"); $("#screen-result").classList.remove("hidden"); $("#phone-title").textContent = "테스트 결과"; }

function startChat(kind, channel, who) {
  person = who; session = A.createSession({ kind, channel, person, now: clock.now() });
  showChat(`${KIND[kind]} · ${channel === "voice" ? "말로" : "글로"}`);
  render(A.start(session, ctxFor()));
}

function sendText(text) {
  if (!session || !text.trim()) return;
  addMsg("customer", text);
  const ctx = ctxFor();
  const t0 = performance.now();
  const o = A.reply(session, text, ctx);
  session.latency_ms.push(Math.round(performance.now() - t0));
  render(o);
  applyActions(store, o.actions, { now: ctx.now, person, session, scheduleFn: onSchedule, rules: ctx.rules, holidays });
  LOG.record(store, session, people);
  LOG.checkMetrics(store, clock.now());
  refresh();
}

function onSchedule(a) {
  if (a.type === "schedule") {
    const s = SCH.createSchedule({ person_id: person.id, kind: a.kind, base_date: clock.now(), slot: a.slot }, holidays);
    store.push("schedules", s);
    store.push("consents", { person_id: person.id, type: a.kind, granted_at: clock.now().toISOString(), slot: a.slot });
    const note = `재연락 일정 생성: ${fmt(new Date(s.due_at))} (하루 전 알림톡)`;
    renderQueue = renderQueue.then(() => addMsg("sys", note)); // 상담원 말이 다 나온 뒤에 보이게
  }
  if (a.type === "checkup_done" && activeSchedule) {
    const list = store.get("schedules", []);
    const i = list.findIndex((x) => x.id === activeSchedule);
    if (i >= 0) {
      list[i] = SCH.complete(list[i], { continueNext: a.continueNext });
      if (a.continueNext) list.push(SCH.nextCycle(list[i], holidays));
      store.set("schedules", list);
    }
    activeSchedule = null;
  }
}

document.querySelectorAll("[data-channel]").forEach((b) => b.onclick = () => {
  const ch = b.dataset.channel;
  if (ch === "human") {
    startChat("grade_out", "text", P("P-01"));
    sendText("상담사 연결");
    return;
  }
  if (ch === "voice" && !V.canListen) $("#voice-note").textContent = "이 브라우저는 음성 인식이 안 돼요. 말 대신 입력해도 같은 규칙으로 움직여요(읽어 주기는 됩니다).";
  startChat("grade_out", ch, P("P-01"));
});
$("#btn-129").onclick = () => { showChat("보건복지상담센터"); addMsg("sys", "보건복지상담센터 129로 연결합니다(모의). 정부 상담은 그대로 둡니다."); };
$("#btn-remind").onclick = () => {
  startChat("grade_out", "text", P("P-01"));
  session.state = "ask_slot"; session.offered_recheck = true;
  render({ say: ["3개월 뒤 다시 확인해 드릴게요. 언제 연락드리면 편하세요?"], choices: Object.values(SCH.SLOTS).map((x) => x.label), actions: [] });
};
$("#back").onclick = showResult;
$("#say").onsubmit = (e) => { e.preventDefault(); const v = $("#msg").value; $("#msg").value = ""; sendText(v); };
$("#mic").onclick = async () => {
  if (!V.canListen) { $("#voice-note").textContent = "음성 인식은 크롬에서만 돼요. 입력창에 써 주세요."; return; }
  $("#mic").classList.add("on");
  try { const t = await V.listenOnce(); if (t) sendText(t); } catch (err) { addMsg("sys", err.message); }
  $("#mic").classList.remove("on");
};

// ── 시간 · 일정 ──
function nextEventTime(s) {
  const m = { scheduled: s.remind_at, notified: s.due_at, waiting_call2: s.next_call_at, survey_sent: s.survey_deadline }[s.state];
  return m ? Date.parse(m) : Infinity;
}
function handleEvents(s, events) {
  const who = P(s.person_id);
  for (const e of events) {
    if (e.type === "remind") send(store, { at: e.at, to: "customer", kind: "알림톡", payload: { text: `[${who.name}님] 내일 이로움 AI 상담원이 ${KIND[s.kind]} 전화를 드려요. 날짜 바꾸기 · 그만 받기 가능` } });
    if (e.type === "call") send(store, { at: e.at, to: "customer", kind: `전화(모의) ${e.attempt}번째`, payload: { text: `${KIND[s.kind]} 전화 시도 → 운영 화면에서 '받음/안 받음'을 고르세요` } });
    if (e.type === "survey") send(store, { at: e.at, to: "customer", kind: "알림톡", payload: { text: `${KIND[s.kind]} 설문 링크 (7일 안에 답해 주세요)` } });
    if (e.type === "reapply_notice") send(store, { at: e.at, to: "customer", kind: "알림톡", payload: { text: "연락이 닿지 않아 점검 연락을 멈춰요. 원하시면 언제든 다시 신청하세요." } });
    if (e.type === "next_cycle") store.push("schedules", SCH.nextCycle(s, holidays));
  }
}
function advanceTo(target) {
  for (let guard = 0; guard < 200; guard++) {
    const list = store.get("schedules", []);
    let best = -1, t = Infinity;
    list.forEach((s, i) => { const x = nextEventTime(s); if (x < t) { t = x; best = i; } });
    if (best < 0 || t > target) break;
    clock.set(new Date(t));
    const r = SCH.tick(list[best], clock.now());
    list[best] = r.schedule; store.set("schedules", list);
    handleEvents(r.schedule, r.events);
  }
  clock.set(new Date(target));
  refresh();
}
document.querySelectorAll("[data-adv]").forEach((b) => b.onclick = () => advanceTo(clock.now().getTime() + Number(b.dataset.adv) * DAY));
$("#reset").onclick = () => { if (confirm("가상 데이터와 시각을 처음 상태로 되돌릴까요?")) { store.clearAll(); location.reload(); } };

function scheduleAction(id, what) {
  const list = store.get("schedules", []);
  const i = list.findIndex((x) => x.id === id); if (i < 0) return;
  const s = list[i]; const who = P(s.person_id);
  if (what === "answer" || what === "survey") {
    list[i] = SCH.answered(s); store.set("schedules", list); activeSchedule = s.id;
    selectTab("customer");
    startChat(s.kind, what === "survey" ? "text" : "voice", who);
  } else if (what === "miss") {
    const r = SCH.missed(s); list[i] = r.schedule; store.set("schedules", list); handleEvents(r.schedule, r.events);
  } else {
    store.set("schedules", SCH.cancelAll(list, s.person_id, what));
    send(store, { at: clock.now().toISOString(), to: "customer", kind: "알림톡", payload: { text: what === "opt_out" ? "앞으로 재연락을 보내지 않아요(확인)" : "반납 처리로 점검 일정을 멈췄어요" } });
  }
  refresh();
}

// ── 운영 · 상담사 화면 그리기 ──
const STATE_LABEL = { scheduled: "예정", notified: "하루 전 알림 보냄", calling: "전화 중", waiting_call2: "2번째 전화 대기", survey_sent: "설문 대기(7일)", in_progress: "상담 중", done: "완료", closed_G: "연락 안 됨(G)", stopped: "멈춤(2주기 무응답)", cancelled: "취소" };
function refresh() {
  runTaskChecks();
  $("#now").textContent = fmt(clock.now());
  $("#schedules").innerHTML = store.get("schedules", []).map((s) => {
    const btn = [];
    if (s.state === "calling") btn.push(`<button data-s="${s.id}" data-a="answer">받음</button><button data-s="${s.id}" data-a="miss">안 받음</button>`);
    if (s.state === "survey_sent") btn.push(`<button data-s="${s.id}" data-a="survey">설문 응답함</button>`);
    if (!["done", "stopped", "cancelled", "closed_G"].includes(s.state)) btn.push(`${s.kind === "checkup_6m" ? `<button data-s="${s.id}" data-a="returned">반납</button>` : ""}<button data-s="${s.id}" data-a="opt_out">그만 받기</button>`);
    return `<tr><td>${esc(P(s.person_id)?.name)}</td><td>${KIND[s.kind]} ${s.cycle}주기</td><td>${fmt(new Date(s.due_at))}</td><td>${STATE_LABEL[s.state] ?? s.state}${s.stop_reason ? ` · ${s.stop_reason}` : ""}${s.no_answer_streak ? ` · 무응답 ${s.no_answer_streak}` : ""}</td><td>${btn.join("")}</td></tr>`;
  }).join("") || `<tr><td colspan="5" class="muted">일정 없음</td></tr>`;
  document.querySelectorAll("[data-s]").forEach((b) => b.onclick = () => scheduleAction(b.dataset.s, b.dataset.a));

  const ob = store.get("outbox", []);
  $("#outbox").innerHTML = ob.slice().reverse().map((m) => `<li><span class="tag">${esc(m.kind)}</span>${esc(fmt(new Date(m.at)))} → ${esc(m.to)}<br>${esc(m.payload?.text ?? JSON.stringify(m.payload))}</li>`).join("") || `<li class="muted">비어 있음</li>`;
  $("#alerts").innerHTML = store.get("alerts", []).map((a) => `<li>${esc(a.day)} ${esc(a.text)}</li>`).join("") || `<li class="muted">경보 없음</li>`;
  const rep = LOG.monthlyReport(store);
  $("#report").textContent = `상담 ${rep.sessions}건 · 6개월 점검 ${rep.checkups}건\n분류: ${Object.entries(rep.byClass).map(([k, v]) => `${k}(${CLASS_LABEL[k]}) ${v}`).join(", ") || "-"}\n사람 넘김: ${Object.entries(rep.byHandoff).map(([k, v]) => `${k} ${v}`).join(", ") || "-"}\nA/S 품목: ${Object.entries(rep.bItems).map(([k, v]) => `${k} ${v}`).join(", ") || "-"}`;
  $("#candidates").innerHTML = rules.candidates.map((c) => `<li><span class="tag">${esc(c.status)}</span>${esc(c.id)} ${esc(c.topic)}</li>`).join("") +
    LOG.candidateList(store).filter((c) => c.show).map((c) => `<li><span class="tag yellow">${esc(c.status)}</span>"${esc(c.sample)}" ${c.count}건 <button data-c="${esc(c.key)}" data-d="승인">승인</button><button data-c="${esc(c.key)}" data-d="거절">거절</button></li>`).join("");
  document.querySelectorAll("[data-c]").forEach((b) => b.onclick = () => {
    const d = store.get("candidate_decisions", {}); const cnt = LOG.candidateList(store).find((c) => c.key === b.dataset.c)?.count ?? 0;
    d[b.dataset.c] = { status: b.dataset.d === "승인" ? "승인(사람이 rules.json 수정 후 재시험)" : "거절", count: cnt }; store.set("candidate_decisions", d); refresh();
  });

  drawTasks();
  const prov = ob.map((m, i) => ({ ...m, i })).filter((m) => m.to === "provider");
  $("#provider").innerHTML = prov.slice().reverse().map((m) => `<li><span class="tag green">${esc(m.payload.item)}</span><br>문제: ${esc(m.payload.problem)}<br>연락 가능: ${esc(m.payload.contact_time)}<br>${m.confirmed ? '<span class="ok">확인함 → 고객에게 알림</span>' : `<button data-p="${m.i}">사업소 확인</button><button data-late="${m.i}">기한 지남(모의)</button>`}</li>`).join("") || `<li class="muted">받은 내용 없음</li>`;
  document.querySelectorAll("[data-p]").forEach((b) => b.onclick = () => {
    const o = store.get("outbox", []); o[Number(b.dataset.p)].confirmed = true; store.set("outbox", o);
    send(store, { at: clock.now().toISOString(), to: "customer", kind: "알림톡", payload: { text: "사업소가 내용을 확인했어요. 곧 연락드릴 거예요." } }); refresh();
  });
  document.querySelectorAll("[data-late]").forEach((b) => b.onclick = () => {
    const o = store.get("outbox", []); o[Number(b.dataset.late)].confirmed = true; store.set("outbox", o);
    addTask(store, { kind: "사업소 미확인 → 이로움 상담사 연락", person_id: "P-02", summary: o[Number(b.dataset.late)].payload.problem, at: clock.now().toISOString() }); refresh();
  });
}

// ── 상담사 작업: 기한 · 알림 · 경보 · 통화 결과 (Q24) ──
const REASON = { emergency: "위급", request: "고객이 사람 요청", out_of_rule: "규정 밖 질문", pending_policy: "제도 변경 중 주제", misunderstand: "말이 안 통함",
  diagnosed_grade_out: "진단 있음 + 등급외", complaint: "불만 · 이탈" };
function runTaskChecks() {
  const now = clock.now();
  const r = TK.check(store.get("tasks", []), now);
  store.set("tasks", r.tasks);
  for (const e of r.events) handleTaskEvent(e, now);
}
function handleTaskEvent(e, now) {
  const who = P(e.task.person_id)?.name ?? "";
  if (e.type === "remind_counselor") LOG.alert(store, `remind:${e.task.id}`, `[담당 상담사] 1시간 뒤 기한: ${who} · ${e.task.kind}`, now);
  if (e.type === "overdue") {
    if (e.urgent) LOG.alert(store, `overdue:${e.task.id}`, `[상위 담당자 · 위급] 기한 넘김: ${who} · ${e.task.kind}`, now);
    else LOG.alert(store, "overdue:normal", `[상위 담당자] 기한 넘긴 일반 작업이 있어요(하루 1번 묶음)`, now);
  }
  if (e.type === "absent_urgent") LOG.alert(store, `absent:${e.task.id}:${e.task.attempts}`, `[상위 담당자 · 위급] 부재: ${who} · 바로 확인 필요`, now);
  if (e.type === "absent_alimtalk") send(store, { at: e.at, to: "customer", kind: "알림톡", payload: { text: "상담사가 두 번 연락드렸는데 닿지 않았어요. 편하실 때 '상담사 연결'을 눌러 주세요." } });
}
function drawTasks() {
  const now = clock.now().getTime();
  const tasks = store.get("tasks", []);
  const sessions = store.get("sessions", []);
  $("#tasks").innerHTML = tasks.map((t, i) => ({ t, i })).reverse().map(({ t, i }) => {
    const late = t.status === "open" && t.due_at && now >= Date.parse(t.due_at);
    const conv = sessions.find((s) => s.id === t.session_id)?.turns ?? [];
    const head = `<span class="tag ${t.urgent ? "red" : ""}">${esc(t.kind)}</span>${esc(P(t.person_id)?.name ?? "")}${t.reason ? ` · ${esc(REASON[t.reason] ?? t.reason)}` : ""}`;
    const due = t.due_at ? `<br><span class="small ${late ? "bad" : "muted"}">기한 ${esc(fmt(new Date(t.due_at)))}${late ? " · 기한 넘김" : ""}${t.attempts ? ` · 부재 ${t.attempts}회` : ""}</span>` : "";
    const notices = t.notices?.length ? `<br><span class="small">AI가 이미 한 안내: ${t.notices.map((n) => `<span class="tag green">${esc(n)}</span>`).join("")}</span>` : "";
    const follow = t.followups?.length ? `<div class="small"><b>추가 질문(넘긴 뒤 고객이 한 말):</b>${t.followups.map((f) => `<div>· ${esc(f.text)}</div>`).join("")}</div>` : "";
    const body = conv.length ? `<details><summary class="small">대화 전체 보기(가명 처리)</summary>${conv.map((c) => `<div class="small ${c.who === "ai" ? "muted" : ""}">${c.who === "ai" ? "AI" : "고객"}: ${esc(c.text)}</div>`).join("")}</details>`
      : `<br><span class="small">${esc(t.summary ?? t.problem ?? t.what ?? "")}</span>`;
    const hist = t.history?.length ? `<br><span class="small muted">기록: ${t.history.map((h) => `${esc(h.result)}(${esc(fmt(new Date(h.at)))})`).join(" → ")}</span>` : "";
    const btns = t.status === "open" ? (t.due_at ? `<div class="row">${TK.RESULTS.map((r) => `<button data-t="${i}" data-r="${r}">${r}</button>`).join("")}</div>` : `<div class="row"><button data-t="${i}" data-r="처리">처리</button></div>`) : `<span class="ok small"> 닫힘</span>`;
    return `<li>${head}${due}${notices}${follow}${body}${hist}${btns}</li>`;
  }).join("") || `<li class="muted">작업 없음</li>`;
  document.querySelectorAll("[data-t]").forEach((b) => b.onclick = () => {
    const list = store.get("tasks", []); const i = Number(b.dataset.t);
    if (b.dataset.r === "처리") { list[i].status = "done"; store.set("tasks", list); refresh(); return; }
    const r = TK.record(list[i], b.dataset.r, clock.now(), { rules: liveRules(), holidays });
    if (r.error) { alert(r.error); return; }
    list[i] = r.task; store.set("tasks", list);
    for (const e of r.events) handleTaskEvent(e, clock.now());
    refresh();
  });
}
// ── 제도 변경 점검 ──
$("#sample").innerHTML = samplesDoc.samples.map((s) => `<option value="${s.id}">${esc(s.meta.notice_id)} (${s.id === "S-red" ? "한도 변경 · 유예 포함" : "알림 수단 추가"})</option>`).join("");
$("#analyze").onclick = () => {
  const sample = samplesDoc.samples.find((s) => s.id === $("#sample").value);
  const reported = store.get("policy_reports", []);
  const r = analyze(sample, reported);
  if (r.duplicate) { $("#policy-report").innerHTML = `<div class="report">이미 보고한 변경이에요(${esc(r.notice_id)} · ${esc(r.revised_at)}). 다시 보고하지 않아요.</div>`; return; }
  store.push("policy_reports", r);
  store.set("pending_topics", [...new Set([...store.get("pending_topics", []), ...r.topics])]);
  drawPolicy(r);
};
function drawPolicy(r) {
  const lv = { red: "빨강 · 자동 중단", yellow: "노랑 · 자세히 검토", green: "초록 · 빠르게 확인" }[r.level];
  $("#policy-report").innerHTML = `<div class="report ${r.level}">
    <p><span class="tag ${r.level}">${lv}</span><b>${esc(r.notice_id)}</b></p>
    <p class="small">공포일 ${esc(r.promulgated)} · 시행일 ${r.effective.map((e) => `${esc(e.scope)} ${esc(e.date)}`).join(" / ") || '<span class="bad">못 찾음</span>'}</p>
    <p class="small">유예 표현: ${r.grace_hits.map((h) => `<b>${esc(h.word)}</b>`).join(", ") || "없음"}</p>
    <p class="small">원문 인용: ${r.quote_check.map((q) => q.ok ? '<span class="ok">일치</span>' : '<span class="bad">원문에 없음</span>').join(", ")} · 숫자: ${r.number_check.map((n) => n.ok ? '<span class="ok">일치</span>' : `<span class="bad">불일치 ${esc(n.mismatch.join(","))}</span>`).join(", ")} · 두 요약: ${r.two_summary_diff ? '<span class="bad">다름</span>' : '<span class="ok">같음</span>'}</p>
    <p class="small">이유: ${esc(r.reasons.join(" · ") || "-")}</p>
    <p class="small muted">승인 전에는 이 주제(${esc(r.topics.join(", "))}) 질문을 AI가 답하지 않고 사람 상담으로 보냅니다.</p>
    ${r.level === "red" ? '<label class="row small"><input type="checkbox" id="confirm-red"> 담당자가 빨강 항목을 확인함</label>' : ""}
    <div class="row"><button id="approve">승인 → 재시험 → 시행일부터 적용</button><button id="reject" class="ghost">거절</button></div></div>`;
  $("#approve").onclick = () => {
    if (r.level === "red" && !$("#confirm-red")?.checked) { alert("빨강은 담당자 확인 전에는 반영할 수 없어요(AC-99)."); return; }
    const g = runGolden({ rules, policy, golden, people }).summary;
    if (g.emergencyMissed > 0 || g.classAccuracy < 0.9) { alert("골든셋 재시험 실패: 반영하지 않아요(AC-75)."); return; }
    store.set("pending_topics", store.get("pending_topics", []).filter((t) => !r.topics.includes(t)));
    $("#policy-report").insertAdjacentHTML("beforeend", `<p class="ok">승인됨 · 골든셋 재시험 통과 · ${esc(r.effective.map((e) => e.date).join(", "))}부터 적용 예약(POC에서는 정본 파일을 사람이 고친다)</p>`);
  };
  $("#reject").onclick = () => { store.set("pending_topics", store.get("pending_topics", []).filter((t) => !r.topics.includes(t))); $("#policy-report").insertAdjacentHTML("beforeend", `<p class="muted">거절됨 · 기존 정본 유지</p>`); };
}

// ── 시험 결과 ──
$("#run-tests").onclick = () => {
  const { rows, summary: s } = runGolden({ rules, policy, golden, people });
  const pass = (ok) => ok ? '<span class="ok">통과</span>' : '<span class="bad">실패</span>';
  $("#test-summary").innerHTML = `<div class="summary">
    <div>위급 놓침<b>${s.emergencyMissed}건</b>${pass(s.emergencyMissed === 0)} 기준 0건</div>
    <div>규정 밖 직접 답<b>${s.outOfRuleDirect}건</b>${pass(s.outOfRuleDirect === 0)} 기준 0건</div>
    <div>분류 일치율<b>${(s.classAccuracy * 100).toFixed(0)}%</b>${pass(s.classAccuracy >= 0.9)} 기준 90% 이상</div>
    <div>개인정보 유출<b>${s.privacyFailed}건</b>${pass(s.privacyFailed === 0)} ${s.privacyCount}문항 중</div>
    <div>전체 일치<b>${s.passed}/${s.total}</b>오경보 ${s.falseEmergency}건</div></div>
    <p class="muted small">한계: 골든셋을 규칙과 같은 사람이 만들었다. 실제 운영에서는 사람 콜 100건의 실제 대답으로 다시 만든다.</p>`;
  $("#test-rows").innerHTML = rows.map((r) => `<tr><td>${r.id}</td><td>${esc(r.input)}</td><td class="small">${r.checks.map(([k, g, w]) => `${k}: ${esc(String(g))}${g === w ? "" : ` (기대 ${esc(String(w))})`}`).join("<br>")}</td><td>${pass(r.ok)}</td></tr>`).join("");
};

// ── 탭 ──
function selectTab(name) {
  document.querySelectorAll("[data-tab]").forEach((b) => b.setAttribute("aria-selected", String(b.dataset.tab === name)));
  document.querySelectorAll(".tab").forEach((t) => t.classList.toggle("on", t.id === `tab-${name}`));
  refresh();
}
document.querySelectorAll("[data-tab]").forEach((b) => b.onclick = () => selectTab(b.dataset.tab));
// ── 목소리 비교 (사용자 피드백: 끝 올리기가 기계음처럼 들림) ──
function fillVoices() {
  const sel = $("#voice-pick"); const list = V.koreanVoices();
  sel.innerHTML = list.map((v) => `<option ${v.name === V.voiceName() ? "selected" : ""}>${esc(v.name)}</option>`).join("") || "<option>한국어 목소리 없음</option>";
  voiceNote();
}
const savedVoice = store.get("voice"); if (savedVoice) V.setVoice(savedVoice);
V.setRise(store.get("rise", true)); $("#rise").checked = V.riseOn();
V.onVoicesChanged(fillVoices);
$("#voice-pick").onchange = (e) => { V.setVoice(e.target.value); store.set("voice", e.target.value); voiceNote(); };
$("#rise").onchange = (e) => { V.setRise(e.target.checked); store.set("rise", e.target.checked); };
$("#voice-test").onclick = () => { V.stopSpeaking(); V.speak("결과 보시고 많이 놀라셨죠. 어떤 점이 제일 걱정되세요?"); };
const voiceNote = () => { $("#voice-note").textContent = (V.canListen ? "음성 인식 가능." : "이 브라우저는 음성 인식이 안 돼요(크롬 · 엣지 권장). 입력창에 써도 같은 규칙으로 움직여요.") + ` 읽어 주는 목소리: ${V.voiceName()}`; };
fillVoices(); setTimeout(fillVoices, 800);
refresh();
