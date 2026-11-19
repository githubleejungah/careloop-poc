// 재연락 날짜 계산 100% (AC-29~40 · 70 · 100~104)
import { test } from "node:test";
import assert from "node:assert/strict";
import { computeDue, clampQuiet, createSchedule, tick, missed, answered, cancelAll, nextCycle, isQuiet } from "../site/js/scheduler.js";
import { kst, DAY } from "../site/js/clock.js";
import { holidays } from "./helpers.js";

const iso = (d) => d.toISOString().slice(0, 16);

test("등급외 결과일 + 90일, 평일 저녁 (AC-29 · 31)", () => {
  assert.equal(iso(computeDue(kst("2026-11-19"), 90, "weekday_evening", holidays)), "2027-02-17T19:00");
});
test("기준일이 설 연휴면 다음 영업일로 (AC-32)", () => {
  // 2026-11-10 + 90 = 2027-02-08(설) → 02-09(대체공휴일) → 02-10
  assert.equal(iso(computeDue(kst("2026-11-10"), 90, "weekday_evening", holidays)), "2027-02-10T19:00");
});
test("주말 낮을 고르면 가장 가까운 주말 (같은 거리면 뒤쪽)", () => {
  assert.equal(iso(computeDue(kst("2026-11-19"), 90, "weekend_day", holidays)), "2027-02-20T11:00");
});
test("배송 완료일 + 180일 (AC-30)", () => {
  assert.equal(iso(computeDue(kst("2026-05-20"), 180, "weekday_evening", holidays)), "2026-11-16T19:00");
});
test("밤 9시~아침 8시는 연락하지 않음 (AC-40)", () => {
  assert.equal(iso(clampQuiet(kst("2026-11-19T22:00"))), "2026-11-20T08:00");
  assert.equal(iso(clampQuiet(kst("2026-11-19T07:00"))), "2026-11-19T08:00");
  assert.equal(isQuiet(kst("2026-11-19T20:59")), false);
});
test("하루 전 알림 (AC-35)", () => {
  const s = createSchedule({ person_id: "P-01", kind: "recheck_3m", base_date: kst("2026-11-19"), slot: "weekday_evening" }, holidays);
  assert.equal(Date.parse(s.due_at) - Date.parse(s.remind_at), DAY);
});
test("전화 2번 → 알림톡 설문 → 7일 무응답이면 G, 2주기 연속이면 멈춤 (AC-36 · 37 · 103 · 104)", () => {
  let s = createSchedule({ person_id: "P-02", kind: "checkup_6m", base_date: kst("2026-05-20") }, holidays);
  let r = tick(s, new Date(Date.parse(s.remind_at)));
  assert.equal(r.schedule.state, "notified"); assert.equal(r.events[0].type, "remind");
  r = tick(r.schedule, new Date(Date.parse(s.due_at)));
  assert.equal(r.schedule.state, "calling"); assert.equal(r.events[0].attempt, 1);
  r = missed(r.schedule); assert.equal(r.schedule.state, "waiting_call2");
  r = tick(r.schedule, new Date(Date.parse(r.schedule.next_call_at)));
  assert.equal(r.schedule.attempts, 2);
  r = missed(r.schedule); assert.equal(r.schedule.state, "survey_sent"); assert.equal(r.events[0].type, "survey");
  const deadline = Date.parse(r.schedule.survey_deadline);
  assert.equal(deadline - Date.parse(r.schedule.next_call_at), 7 * DAY);
  r = tick(r.schedule, new Date(deadline));
  assert.equal(r.schedule.state, "closed_G"); assert.equal(r.schedule.no_answer_streak, 1);
  assert.equal(r.events[0].type, "next_cycle");
  // 다음 주기도 무응답
  let s2 = nextCycle(r.schedule, holidays);
  assert.equal(s2.no_answer_streak, 1);
  let q = tick(tick(s2, new Date(Date.parse(s2.due_at))).schedule, new Date(Date.parse(s2.due_at)));
  q = missed(q.schedule); q = tick(q.schedule, new Date(Date.parse(q.schedule.next_call_at))); q = missed(q.schedule);
  q = tick(q.schedule, new Date(Date.parse(q.schedule.survey_deadline)));
  assert.equal(q.schedule.state, "stopped"); assert.equal(q.events[0].type, "reapply_notice");
});
test("전화를 받으면 무응답 기록이 0으로", () => {
  const s = { ...createSchedule({ person_id: "P-02", kind: "checkup_6m", base_date: kst("2026-05-20") }, holidays), no_answer_streak: 1 };
  assert.equal(answered(s).no_answer_streak, 0);
});
test("3개월 재검사는 다시 동의해야만 다음 일정 (AC-100)", () => {
  const s = createSchedule({ person_id: "P-01", kind: "recheck_3m", base_date: kst("2026-11-19") }, holidays);
  assert.equal(nextCycle(s, holidays, { consent: false }), null);
  assert.ok(nextCycle(s, holidays, { consent: true }));
});
test("반납 · 철회 등 멈춤 사건이면 남은 일정 0건 (AC-39 · 58 · 102)", () => {
  const a = createSchedule({ person_id: "P-02", kind: "checkup_6m", base_date: kst("2026-05-20") }, holidays);
  const b = createSchedule({ person_id: "P-01", kind: "recheck_3m", base_date: kst("2026-11-19") }, holidays);
  const out = cancelAll([a, b], "P-02", "returned");
  assert.equal(out[0].state, "cancelled"); assert.equal(out[1].state, "scheduled");
});
