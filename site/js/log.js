// 기록 · 지표 · 경보 · 보고 (AC-60~63 · 71~73 · 109 · 111). 가명 데이터만 쓴다.
import { leaks } from "./privacy.js";

/** 상담 1건의 4가지 기록 (AC-71). 원문이 섞이면 저장하지 않는다 (AC-89). */
export function record(store, session, people = []) {
  const row = {
    id: session.id, kind: session.kind, channel: session.channel, person_id: session.person_id,
    class: session.class, handoff: session.handoff, repeat_explain_count: session.repeat_explain_count,
    latency_ms: session.latency_ms, created_at: session.created_at, notices: session.notices ?? [],
    turns: session.turns.filter((t) => !leaks(t.text, people)),
  };
  const all = store.get("sessions", []).filter((x) => x.id !== row.id);
  all.push(row); store.set("sessions", all);
  return row;
}

/** 같은 경보는 하루 1번 (AC-109). */
export function alert(store, key, text, now) {
  const day = now.toISOString().slice(0, 10);
  const list = store.get("alerts", []);
  if (list.some((a) => a.key === key && a.day === day)) return false;
  list.push({ key, text, day, at: now.toISOString() }); store.set("alerts", list);
  return true;
}

/** 경보 기준 예시: 사람 넘김 비율이 기준선보다 크게 오르면 (기준값은 AS-10, POC 값은 시연용). */
export function checkMetrics(store, now, { handoffRateLimit = 0.5 } = {}) {
  const s = store.get("sessions", []);
  if (s.length < 4) return null;
  const rate = s.filter((x) => x.handoff).length / s.length;
  if (rate > handoffRateLimit) return alert(store, "handoff_rate", `사람 넘김 비율 ${(rate * 100).toFixed(0)}% (시연 기준 ${handoffRateLimit * 100}% 초과)`, now);
  return null;
}

/** 월간 보고: 개인을 알아볼 수 없는 묶음 숫자만 (AC-60 · 61). */
export function monthlyReport(store) {
  const s = store.get("sessions", []);
  const byClass = {}; const byHandoff = {}; let checkups = 0;
  for (const x of s) {
    if (x.class) byClass[x.class] = (byClass[x.class] ?? 0) + 1;
    if (x.handoff) byHandoff[x.handoff] = (byHandoff[x.handoff] ?? 0) + 1;
    if (x.kind === "checkup_6m") checkups += 1;
  }
  const tasks = store.get("tasks", []);
  const bItems = {};
  for (const t of tasks.filter((t) => t.kind === "A/S 접수")) bItems[t.item ?? "미상"] = (bItems[t.item ?? "미상"] ?? 0) + 1;
  return { sessions: s.length, checkups, byClass, byHandoff, bItems };
}

/** 규정 후보: 같은 질문 묶음. 거절된 후보는 새 사례가 늘 때만 다시 (AC-62 · 111). */
export function candidateList(store) {
  const raw = store.get("candidates", []);
  const decided = store.get("candidate_decisions", {});
  const groups = {};
  for (const c of raw) {
    const key = c.text.replace(/[?!.~\s]/g, "").slice(0, 12);
    (groups[key] ??= { key, sample: c.text, count: 0 }).count += 1;
  }
  return Object.values(groups).map((g) => {
    const d = decided[g.key];
    const reopen = !d || (d.status === "거절" && g.count > d.count);
    return { ...g, status: d?.status ?? "검토 대기", show: reopen };
  });
}
