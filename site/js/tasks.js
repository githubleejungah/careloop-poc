// 상담사 작업 누락 방지 규칙 (Q24 · AC-122~130). 순수 함수만 둔다. 시각은 clock.js 규칙(UTC 칸 = 한국 시각).
// 상담 시간 · 불만 연락 기한은 rules.json의 handoff에서만 읽는다(AC-131). 여기에 숫자를 다시 쓰지 않는다.
import { DAY } from "./clock.js";
import { inCounselHours } from "./guard.js";

const HOUR = 60 * 60 * 1000;
export const REMIND_BEFORE_MS = HOUR;                                         // 기한 1시간 전 알림(A24 ②)
export const CONNECT_NOW_MS = 3 * 60 * 1000;                                  // 상담 시간 안 연결 3분(AC-24)
export const RETRY_GAP_MS = 2 * HOUR;                                         // 부재 뒤 다시 시도 간격(AS-15)
export const RESULTS = ["연결됨", "부재", "다시 연락"];

/** cal = { rules, holidays }. 상담 시간 정본은 rules.handoff.counsel_hours. */
const hoursOf = (cal) => cal.rules.handoff.counsel_hours;
const iso = (d) => d.toISOString().slice(0, 10);
const atHour = (d, h) => { const x = new Date(d); x.setUTCHours(h, 0, 0, 0); return x; };
export const isBusinessDay = (d, cal) => hoursOf(cal).weekdays.includes(d.getUTCDay()) && !(cal.holidays ?? []).includes(iso(d));
export const inHours = (d, cal) => inCounselHours(d, cal.rules, cal.holidays ?? []);

/** 다음 영업일의 h시 (오늘이 영업일이고 아직 그 시각 전이면 오늘). */
export function nextBusinessAt(now, hour, cal) {
  let d = atHour(now, hour);
  if (d.getTime() <= now.getTime() || !isBusinessDay(d, cal)) {
    d = atHour(new Date(now.getTime() + DAY), hour);
    while (!isBusinessDay(d, cal)) d = new Date(d.getTime() + DAY);
  }
  return d;
}

/**
 * 처리 기한 (AC-122).
 * - 상담 시간 안 연결: 3분
 * - 위급 · 상담 시간 밖: 다음 영업일 상담 시작 시각
 * - 불만: rules.handoff.complaint_callback_hours
 * - 그 밖의 콜백: 다음 영업일 상담 마감 시각 전
 */
export function dueFor({ reason, urgent, kind }, now, cal) {
  if (reason === "complaint") return new Date(now.getTime() + cal.rules.handoff.complaint_callback_hours * HOUR);
  if (inHours(now, cal) && kind !== "콜백 예약") return new Date(now.getTime() + CONNECT_NOW_MS);
  if (urgent) return nextBusinessAt(now, hoursOf(cal).start, cal);
  return nextBusinessAt(now, hoursOf(cal).end, cal);
}

/** 새 작업. 상담 기록(session_id)과 AI가 이미 한 안내(notices)를 함께 둔다 (AC-126). */
export function makeTask(t, now, cal) {
  const due = dueFor(t, now, cal);
  return { ...t, id: t.id ?? `T-${now.getTime().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
    status: "open", due_at: due.toISOString(), attempts: 0, reminded: false, escalated: false, history: [] };
}

/** 시간이 흐를 때 점검: 기한 1시간 전 알림, 기한 넘김 경보 (AC-123 · 124). */
export function check(tasks, now) {
  const events = [];
  const t = now.getTime();
  const next = tasks.map((task) => {
    if (task.status !== "open" || !task.due_at) return task;
    const due = Date.parse(task.due_at);
    const x = { ...task };
    if (!x.reminded && t >= due - REMIND_BEFORE_MS && t < due) {
      x.reminded = true;
      events.push({ type: "remind_counselor", task: x, at: new Date(Math.max(due - REMIND_BEFORE_MS, 0)).toISOString() });
    }
    if (!x.escalated && t >= due) {
      x.escalated = true;
      events.push({ type: "overdue", task: x, urgent: !!x.urgent, at: x.due_at });
    }
    return x;
  });
  return { tasks: next, events };
}

/**
 * 통화 결과를 적어야 닫힌다 (AC-125). 부재면 다시 시도, 위급은 1번 부재로 상위 경보,
 * 일반은 2번 부재면 알림톡을 보내고 닫는다 (AC-127 · 128 · 129).
 */
export function record(task, result, now, cal) {
  if (!RESULTS.includes(result)) return { task, events: [], error: "통화 결과(연결됨 · 부재 · 다시 연락)를 골라야 닫을 수 있어요." };
  const x = { ...task, history: [...task.history, { result, at: now.toISOString() }] };
  const events = [];
  if (result === "연결됨") { x.status = "done"; return { task: x, events }; }
  if (result === "다시 연락") {
    x.due_at = nextBusinessAt(now, hoursOf(cal).end, cal).toISOString(); x.reminded = false; x.escalated = false;
    return { task: x, events };
  }
  x.attempts += 1;
  if (x.urgent) events.push({ type: "absent_urgent", task: x, at: now.toISOString() });
  if (!x.urgent && x.attempts >= 2) {
    x.status = "done";
    events.push({ type: "absent_alimtalk", task: x, at: now.toISOString() });
    return { task: x, events };
  }
  const retry = new Date(now.getTime() + RETRY_GAP_MS);
  x.due_at = (inHours(retry, cal) ? retry : nextBusinessAt(now, hoursOf(cal).start, cal)).toISOString();
  x.reminded = false; x.escalated = false;
  return { task: x, events };
}

/** 안내 문장에 넣을 상담 시간 글귀(요일 · 시작 · 마감). rules.json에서 만든다. */
export function hoursLabel(rules) {
  const h = rules.handoff.counsel_hours;
  const weekdaysOnly = h.weekdays.join(",") === "1,2,3,4,5";
  return `${weekdaysOnly ? "평일" : "상담일"} ${h.start}~${h.end}시`;
}
