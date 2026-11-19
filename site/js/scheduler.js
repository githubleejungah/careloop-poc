// 재연락 일정 (AC-29~40 · 58 · 100~104). 순수 함수만 둔다. 시각은 clock.js 규칙(UTC 칸 = 한국 시각).
import { DAY } from "./clock.js";

export const SLOTS = {
  weekday_day: { label: "평일 낮", weekdays: [1, 2, 3, 4, 5], hour: 10 },
  weekday_evening: { label: "평일 저녁", weekdays: [1, 2, 3, 4, 5], hour: 19 },
  weekend_day: { label: "주말 낮", weekdays: [0, 6], hour: 11 },
};
export const KIND_DAYS = { recheck_3m: 90, checkup_6m: 180 };
export const QUIET = { from: 21, to: 8 };      // 밤 9시~아침 8시 연락 금지 (AC-40)
export const SURVEY_WAIT_DAYS = 7;             // AS-8 확정 (AC-103)
export const STOP_AFTER_NO_ANSWER = 2;         // 2주기 연속 G면 멈춤 (AC-104)

const iso = (d) => d.toISOString().slice(0, 10);
const atHour = (d, h) => { const x = new Date(d); x.setUTCHours(h, 0, 0, 0); return x; };

export function isQuiet(d) { const h = d.getUTCHours(); return h >= QUIET.from || h < QUIET.to; }

/** 밤 시간이면 허용 시간(아침 8시)으로 옮긴다 (AC-40). */
export function clampQuiet(d) {
  if (!isQuiet(d)) return d;
  const x = new Date(d);
  if (x.getUTCHours() >= QUIET.from) x.setTime(x.getTime() + DAY);
  return atHour(x, QUIET.to);
}

/** 기준일 + 요일 · 시간대 · 공휴일 · 야간 규칙 (AC-29~32 · 40). */
export function computeDue(baseDate, days, slotKey, holidays = []) {
  const slot = SLOTS[slotKey];
  const target = new Date(atHour(baseDate, 0).getTime() + days * DAY);
  // 고른 요일 중 가장 가까운 날 (같은 거리면 뒤쪽 날짜, 너무 이르게 연락하지 않으려고)
  let pick = null;
  for (let k = 0; k <= 7 && !pick; k++) {
    for (const sign of [1, -1]) {
      const d = new Date(target.getTime() + sign * k * DAY);
      if (slot.weekdays.includes(d.getUTCDay())) { pick = d; break; }
    }
  }
  // 공휴일이면 다음 날로, 고른 요일 · 휴일 아님을 만족할 때까지 (AC-32)
  while (holidays.includes(iso(pick)) || !slot.weekdays.includes(pick.getUTCDay())) {
    pick = new Date(pick.getTime() + DAY);
  }
  return clampQuiet(atHour(pick, slot.hour));
}

let seq = 0;
export function createSchedule({ person_id, kind, base_date, slot = "weekday_evening", channel = "call", cycle = 1, no_answer_streak = 0 }, holidays = []) {
  const due = computeDue(new Date(base_date), KIND_DAYS[kind], slot, holidays);
  seq += 1;
  return {
    id: `SC-${Date.now().toString(36)}-${seq}`, person_id, kind, slot, channel, cycle,
    base_date: iso(new Date(base_date)), due_at: due.toISOString(),
    remind_at: clampQuiet(new Date(due.getTime() - DAY)).toISOString(),
    next_call_at: null, survey_deadline: null, state: "scheduled", attempts: 0,
    no_answer_streak, stop_reason: null,
  };
}

/**
 * 시간이 흘렀을 때 할 일. { schedule, events } 를 돌려준다. events는 channels.js가 발송함에 적는다.
 * 상태: scheduled → notified → calling → (missed) waiting_call2 → calling → survey_sent → closed_G / stopped
 */
export function tick(s, now) {
  const ev = [];
  const t = now.getTime();
  const next = { ...s };
  if (next.state === "scheduled" && t >= Date.parse(next.remind_at)) {
    next.state = "notified";
    ev.push({ type: "remind", at: next.remind_at });
  }
  if (next.state === "notified" && t >= Date.parse(next.due_at)) {
    if (next.channel === "alimtalk") {
      next.state = "survey_sent";
      next.survey_deadline = new Date(Date.parse(next.due_at) + SURVEY_WAIT_DAYS * DAY).toISOString();
      ev.push({ type: "survey", at: next.due_at });
    } else {
      next.state = "calling"; next.attempts = 1;
      ev.push({ type: "call", attempt: 1, at: next.due_at });
    }
  }
  if (next.state === "waiting_call2" && t >= Date.parse(next.next_call_at)) {
    next.state = "calling"; next.attempts = 2;
    ev.push({ type: "call", attempt: 2, at: next.next_call_at });
  }
  if (next.state === "survey_sent" && t >= Date.parse(next.survey_deadline)) {
    next.no_answer_streak += 1;
    if (next.no_answer_streak >= STOP_AFTER_NO_ANSWER) {
      next.state = "stopped"; next.stop_reason = "no_answer_2";
      ev.push({ type: "reapply_notice", at: new Date(t).toISOString() });
    } else {
      next.state = "closed_G";
      if (next.kind === "checkup_6m") ev.push({ type: "next_cycle" });
    }
  }
  return { schedule: next, events: ev };
}

/** 전화를 안 받음 (AC-36 · 37). */
export function missed(s) {
  const next = { ...s };
  if (s.attempts <= 1) {
    next.state = "waiting_call2";
    next.next_call_at = clampQuiet(new Date(Date.parse(s.due_at) + DAY)).toISOString();
    return { schedule: next, events: [] };
  }
  const sentAt = Date.parse(s.next_call_at);
  next.state = "survey_sent";
  next.survey_deadline = new Date(sentAt + SURVEY_WAIT_DAYS * DAY).toISOString();
  return { schedule: next, events: [{ type: "survey", at: s.next_call_at }] };
}

/** 전화를 받음 또는 설문에 답함 → 점검 진행. 무응답 연속 기록은 0으로. */
export function answered(s) { return { ...s, state: "in_progress", no_answer_streak: 0 }; }

/** 점검 끝. 다음에도 받을지에 따라 다음 주기 (AC-101). */
export function complete(s, { continueNext }) {
  return { ...s, state: "done", stop_reason: continueNext ? null : "declined_next" };
}

/** 멈춤 사건: 철회 · 반납 · 사용 종료 · 입소 · 탈퇴 · 그만 받기 (AC-39 · 58 · 102). */
export const STOP_EVENTS = ["withdrawn", "returned", "ended", "admitted", "left", "opt_out"];
export function cancelAll(schedules, person_id, reason) {
  return schedules.map((s) => (s.person_id === person_id && !["done", "stopped", "cancelled", "closed_G"].includes(s.state))
    ? { ...s, state: "cancelled", stop_reason: reason } : s);
}

/** 다음 주기 일정(점검 계속 · 무응답 1주기). 3개월 재검사는 다시 동의해야만 만든다(AC-100). */
export function nextCycle(s, holidays, { consent = true } = {}) {
  if (s.kind === "recheck_3m" && !consent) return null;
  return createSchedule({
    person_id: s.person_id, kind: s.kind, base_date: s.due_at, slot: s.slot, channel: s.channel,
    cycle: s.cycle + 1, no_answer_streak: s.no_answer_streak,
  }, holidays);
}
