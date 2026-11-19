// 시연 대화 그대로 다시 보기 (Q26 · AC-133~137). 문장 하나가 아니라 대화 전체를 이어서 본다.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createSession, start, reply } from "../site/js/agent.js";
import { kst } from "../site/js/clock.js";
import { rules, policy, holidays, people } from "./helpers.js";

const ctx = { rules, policy, holidays, people, now: kst("2026-11-19T19:00"), person: people[0] };
const UNRELATED = rules.replies.unrelated;
function talk(lines) {
  const s = createSession({ kind: "grade_out", channel: "text", person: people[0], now: ctx.now });
  start(s, ctx);
  const outs = lines.map((t) => reply(s, t, ctx));
  return { s, outs, said: (i) => outs[i].say.join(" ") };
}
const BASE = ["엄마가 밤에 자꾸 밖에 나가세요", "아직이요", "네", "평일 낮"];

test("일정을 잡은 뒤 '지원 받을 수 있는 건 없나요?'(띄어 씀)에 지원 목록으로 답한다 (AC-133 · 119)", () => {
  const { said } = talk([...BASE, "그럼 지금 지원 받을 수 있는 건 없나요?"]);
  assert.ok(!UNRELATED.some((u) => said(4).includes(u)), said(4));
  assert.match(said(4), /출처:/);
});

test("'아직'이라고 한 뒤 '검사를 받으셨어요'로 바꾸면 결과를 묻는다 — 검사 안내를 반복하지 않음 (AC-134)", () => {
  const { s, outs, said } = talk([...BASE, "생각해보니 치매 검사를 받으셨어요"]);
  assert.match(said(4), /결과에서 치매 진단이 나오셨나요/);
  assert.doesNotMatch(said(4), /치매 검사를 받을 수 있고/);
  assert.deepEqual(outs[4].choices, ["진단 받았어요", "진단은 아니래요", "결과 기다려요"]);
  assert.equal(s.state, "ask_dx_result");
});

test("결과가 '진단 받았어요'면 인정등급 상담사 연결을 1번째로 추천한다 (AC-19 · 134)", () => {
  const { outs } = talk([...BASE, "생각해보니 치매 검사를 받으셨어요", "진단 받았어요"]);
  assert.equal(outs[5].choices[0], "인정등급 상담사 연결 (추천)");
});

test("'진단은 아니래요' · '결과 기다려요'면 잡아 둔 3개월 연락을 그대로 두고 상담사 연결 방법을 알린다 (AC-135)", () => {
  for (const ans of ["진단은 아니래요", "결과 기다려요"]) {
    const { outs, said } = talk([...BASE, "생각해보니 치매 검사를 받으셨어요", ans]);
    assert.match(said(5), /상담사 연결/); assert.match(said(5), /그대로 둘게요/);
    assert.equal(outs[5].actions.filter((a) => a.type === "schedule").length, 0, "일정을 새로 만들지 않음");
  }
});

test("진단을 받았다고 바로 고치면 진단 길로 간다 (AC-134)", () => {
  const { outs } = talk([...BASE, "아 생각해보니 치매 진단 받으셨어요"]);
  assert.equal(outs[4].choices[0], "인정등급 상담사 연결 (추천)");
});

test("상담 중 질문이 아닌 말을 못 알아들으면 '무관' 답 대신 다시 말해 달라고 하고, 2번이면 버튼으로 (AC-136 · 20)", () => {
  const { s, said } = talk([...BASE, "그래서 그렇다고요", "그러니까 그렇다니까요"]);
  for (const i of [4, 5]) assert.ok(!UNRELATED.some((u) => said(i).includes(u)), said(i));
  assert.equal(s.state, "await_buttons");
});

test("되풀이 표현에는 사과를 먼저 한다 (AC-137)", () => {
  const { outs } = talk([...BASE, "그래서 받으셨다니까요"]);
  assert.match(outs[4].say[0], /죄송/);
});

test("다른 주제의 질문은 그대로 '무관' 답 (AC-09)", () => {
  const { said } = talk([...BASE, "내일 날씨 어때요?"]);
  assert.ok(UNRELATED.some((u) => said(4).includes(u)), said(4));
});

// ── Q27: 상담 시간 밖 위급 상담을 넘긴 뒤 (AC-138~142) ──
import { createStore } from "../site/js/store.js";
import { applyActions } from "../site/js/channels.js";

function talkStore(lines) {
  const mem = {}; const store = createStore({ getItem: (k) => mem[k] ?? null, setItem: (k, v) => { mem[k] = v; }, removeItem: (k) => { delete mem[k]; } });
  const s = createSession({ kind: "grade_out", channel: "text", person: people[0], now: ctx.now });
  start(s, ctx);
  const outs = lines.map((t) => { const o = reply(s, t, ctx); applyActions(store, o.actions, { now: ctx.now, person: people[0], session: s, rules, holidays }); return o; });
  return { s, outs, store, said: (i) => outs[i].say.join(" ") };
}
const FALL = ["지난주에 넘어지셨어요", "아직이요", "보행기를 침대로 바꿀 수 있나요?"];

test("위급으로 넘긴 뒤 '아직이요'에는 안전을 다시 확인한다: 질문 · 119 · 연락 시각 (AC-138)", () => {
  const { outs, said } = talkStore(FALL);
  assert.doesNotMatch(said(1), /이미 상담사에게 넘겨/);
  assert.match(said(1), /일어나시기 어렵|많이 아프/);
  assert.match(said(1), /119/);
  assert.match(said(1), /11월 20일\(금\) 오전 10시까지/);
  assert.deepEqual(outs[1].choices, ["지금도 어려워요", "괜찮아요"]);
});

test("넘긴 뒤 규정 밖 질문은 선택지 없이 '상담사에게 같이 전해 둘게요' (AC-139)", () => {
  const { outs, said } = talkStore(FALL);
  assert.match(said(2), /상담사/); assert.deepEqual(outs[2].choices, []);
});

test("넘긴 뒤 규정 안 질문은 근거와 출처로 답한다 (AC-140)", () => {
  const { said } = talkStore(["지난주에 넘어지셨어요", "치매안심센터는 어디서 검사해요?"]);
  assert.match(said(1), /출처:/);
});

test("넘긴 뒤 고객 말은 상담사 작업 1건의 '추가 질문'에 붙는다 — 작업이 늘지 않음 (AC-141)", () => {
  const { store } = talkStore(FALL);
  const tasks = store.get("tasks", []);
  assert.equal(tasks.length, 1);
  assert.deepEqual(tasks[0].followups.map((f) => f.text), ["아직이요", "보행기를 침대로 바꿀 수 있나요?"]);
});

test("'지금도 어려워요'면 바로 119를 다시 말한다", () => {
  const { said } = talkStore(["지난주에 넘어지셨어요", "아직이요", "지금도 어려워요"]);
  assert.match(said(2), /지금 바로 119/);
});

test("같은 안내 문장을 연속 2번 하지 않는다 (AC-142)", () => {
  const { outs } = talkStore(["지난주에 넘어지셨어요", "아직이요", "음", "음", "음"]);
  for (let i = 1; i < outs.length; i++) assert.notEqual(outs[i].say.join(" / "), outs[i - 1].say.join(" / "), `${i}번째`);
});

// ── Q29: 자동 시연 첫 보고서(2026-11-19, 시드 1)에서 찾은 3종 (AC-148~150) ──
test("일정을 잡은 뒤 '언제 연락 와요?'에는 잡힌 날짜로 답한다 (AC-148)", () => {
  const { said } = talk([...BASE, "언제 연락 와요?"]);
  assert.ok(!UNRELATED.some((u) => said(4).includes(u)), said(4));
  assert.match(said(4), /2027년 2월 17일\(수\) 오전 10시/);
});
test("잡힌 연락이 없을 때 '언제 연락 와요?'에는 아직 없다고 답한다 (AC-148)", () => {
  const { said } = talk(["언제 연락 와요"]);
  assert.match(said(0), /아직 잡힌 연락은 없어요/);
});
test("연락 시간을 고르는 중에 한 질문에 답하고 시간을 다시 묻는다 (AC-149)", () => {
  const { s, outs, said } = talk(["엄마가 밤에 자꾸 밖에 나가세요", "아직이요", "네", "치매안심센터는 어디서 검사해요?"]);
  assert.doesNotMatch(said(3), /못 알아들었/);
  assert.match(said(3), /출처:/);
  assert.match(said(3), /언제 연락드리면 편하세요/);
  assert.equal(s.state, "ask_slot");
  assert.ok(outs[3].choices.length >= 3);
});
test("같은 질문을 다시 하면 '앞과 같아요' 대신 다시 답한다 (AC-150)", () => {
  const { said } = talk(["5등급은 어떻게 받아요?", "아니요", "5등급은 어떻게 받아요?", "5등급은 어떻게 받아요?"]);
  assert.doesNotMatch(said(3), /앞에서 말씀드린 내용과 같아요/);
  assert.match(said(3), /다시 말씀드릴게요/);
  assert.match(said(3), /5등급/);
});
test("물음표 없는 음성 질문('언제 연락 와요')도 예/아니요 · 연락 시간 · 결과 질문을 기다리는 중에 답한다 (AC-148 · 149)", () => {
  const a = talk(["엄마가 밤에 자꾸 밖에 나가세요", "아직이요", "언제 연락 와요"]);
  assert.match(a.said(2), /아직 잡힌 연락은 없어요/); assert.match(a.said(2), /3개월쯤 뒤/);
  const b = talk(["엄마가 밤에 자꾸 밖에 나가세요", "아직이요", "네", "치매안심센터는어디서검사해요"]);
  assert.match(b.said(3), /출처:/); assert.match(b.said(3), /언제 연락드리면 편하세요/);
  const c = talk([...BASE, "생각해보니 치매 검사를 받으셨어요", "언제연락 와요?"]);
  assert.match(c.said(5), /2027년/); assert.match(c.said(5), /진단이 나오셨나요/);
});
