// 상담사 작업 누락 방지 (Q24 · AC-122~130)
import { test } from "node:test";
import assert from "node:assert/strict";
import { dueFor, makeTask, check, record, nextBusinessAt } from "../site/js/tasks.js";
import { applyActions } from "../site/js/channels.js";
import { createStore } from "../site/js/store.js";
import { createSession, start, reply } from "../site/js/agent.js";
import { kst } from "../site/js/clock.js";
import { rules, policy, holidays, people } from "./helpers.js";

const cal = { rules, holidays };

const iso = (d) => d.toISOString().slice(0, 16);
const HOUR = 3600 * 1000;

test("위급 · 상담 시간 밖(목 19시) → 다음 영업일 10:00 (AC-122)", () => {
  assert.equal(iso(dueFor({ reason: "emergency", urgent: true, kind: "콜백 예약" }, kst("2026-11-19T19:00"), cal)), "2026-11-20T10:00");
});
test("금요일 밤 위급 → 월요일 10:00, 공휴일(성탄절)은 건너뜀", () => {
  assert.equal(iso(dueFor({ urgent: true, kind: "콜백 예약" }, kst("2026-11-20T19:00"), cal)), "2026-11-23T10:00");
  assert.equal(iso(dueFor({ urgent: true, kind: "콜백 예약" }, kst("2026-12-24T19:00"), cal)), "2026-12-28T10:00");
});
test("불만은 24시간, 그 밖의 콜백은 다음 영업일 16:00 전", () => {
  assert.equal(iso(dueFor({ reason: "complaint" }, kst("2026-11-19T19:00"), cal)), "2026-11-20T19:00");
  assert.equal(iso(dueFor({ reason: "out_of_rule", kind: "콜백 예약" }, kst("2026-11-19T19:00"), cal)), "2026-11-20T16:00");
});
test("상담 시간 안 사람 연결은 3분 (AC-24)", () => {
  const d = dueFor({ reason: "request", kind: "사람 연결" }, kst("2026-11-20T11:00"), cal);
  assert.equal(d.getTime() - kst("2026-11-20T11:00").getTime(), 3 * 60 * 1000);
});
test("기한 1시간 전 알림 · 기한 넘김 경보는 한 번씩 (AC-123 · 124)", () => {
  let tasks = [makeTask({ kind: "콜백 예약", reason: "emergency", urgent: true }, kst("2026-11-19T19:00"), cal)];
  let r = check(tasks, kst("2026-11-20T09:10"));
  assert.deepEqual(r.events.map((e) => e.type), ["remind_counselor"]);
  r = check(r.tasks, kst("2026-11-20T09:30")); assert.equal(r.events.length, 0);
  r = check(r.tasks, kst("2026-11-20T10:00")); assert.deepEqual(r.events.map((e) => [e.type, e.urgent]), [["overdue", true]]);
  r = check(r.tasks, kst("2026-11-20T12:00")); assert.equal(r.events.length, 0);
});
test("통화 결과 없이는 닫히지 않음 (AC-125)", () => {
  const t = makeTask({ kind: "콜백 예약", reason: "request" }, kst("2026-11-19T19:00"), cal);
  const r = record(t, "처리", kst("2026-11-20T10:00"), cal);
  assert.ok(r.error); assert.equal(r.task.status, "open");
  assert.equal(record(t, "연결됨", kst("2026-11-20T10:00"), cal).task.status, "done");
});
test("위급은 1번 부재로 상위 경보, 일반은 2번 부재면 알림톡 후 닫음 (AC-127 · 128)", () => {
  const u = makeTask({ kind: "콜백 예약", reason: "emergency", urgent: true }, kst("2026-11-19T19:00"), cal);
  const ru = record(u, "부재", kst("2026-11-20T10:00"), cal);
  assert.deepEqual(ru.events.map((e) => e.type), ["absent_urgent"]); assert.equal(ru.task.status, "open");
  assert.equal(iso(new Date(ru.task.due_at)), "2026-11-20T12:00");
  const n = makeTask({ kind: "콜백 예약", reason: "request" }, kst("2026-11-19T19:00"), cal);
  const r1 = record(n, "부재", kst("2026-11-20T15:00"), cal);
  assert.equal(r1.events.length, 0); assert.equal(iso(new Date(r1.task.due_at)), "2026-11-23T10:00");
  const r2 = record(r1.task, "부재", kst("2026-11-23T10:00"), cal);
  assert.deepEqual(r2.events.map((e) => e.type), ["absent_alimtalk"]); assert.equal(r2.task.status, "done");
});
test("상담 시간 밖 위급 상담은 작업 1건만 만들고, 대화 · AI 안내를 함께 남긴다 (AC-126)", () => {
  const store = createStore({ getItem() { return null; }, setItem() { throw new Error("x"); }, removeItem() {} });
  const ctx = { rules, policy, holidays, people, now: kst("2026-11-19T19:00"), person: people[0] };
  const s = createSession({ kind: "grade_out", channel: "voice", person: people[0], now: ctx.now });
  start(s, ctx);
  const o = reply(s, "지난주에 넘어지셨어요", ctx);
  applyActions(store, o.actions, { now: ctx.now, person: people[0], session: s, rules, holidays });
  const tasks = store.get("tasks", []);
  assert.equal(tasks.length, 1);
  assert.equal(tasks[0].urgent, true); assert.equal(iso(new Date(tasks[0].due_at)), "2026-11-20T10:00");
  assert.ok(tasks[0].notices.includes("119 안내함"));
});
test("다음 영업일 계산: 영업일 아침이면 오늘", () => {
  assert.equal(iso(nextBusinessAt(kst("2026-11-20T08:00"), 10, cal)), "2026-11-20T10:00");
});
test("상담 시간을 rules.json에서만 읽는다: 원본을 바꾸면 기한도 바뀐다 (AC-131)", () => {
  const r2 = structuredClone(rules); r2.handoff.counsel_hours.start = 9; r2.handoff.counsel_hours.end = 18; r2.handoff.complaint_callback_hours = 48;
  const c2 = { rules: r2, holidays };
  assert.equal(iso(dueFor({ urgent: true, kind: "콜백 예약" }, kst("2026-11-19T19:00"), c2)), "2026-11-20T09:00");
  assert.equal(iso(dueFor({ kind: "콜백 예약" }, kst("2026-11-19T19:00"), c2)), "2026-11-20T18:00");
  assert.equal(iso(dueFor({ reason: "complaint" }, kst("2026-11-19T19:00"), c2)), "2026-11-21T19:00");
});
