// 자동 시연 (Q28 · AC-143~147): 검사기가 예전 시연 문제를 잡는지, 같은 시드면 같은 결과인지, 위급은 0건인지.
import { test } from "node:test";
import assert from "node:assert/strict";
import { inspect } from "../scripts/demo/checks.mjs";
import { runDemo, loadAll, report } from "../scripts/demo/run.mjs";
import { rules, policy } from "./helpers.js";

const T = (input, tag, say, actions = []) => ({ input, tag, say: [].concat(say), choices: [], actions });
const checks = (turns) => inspect(turns, { rules, policy }).map((f) => f.check);
const HANDED = "말씀하신 내용은 이미 상담사에게 넘겨 드렸어요. 곧 연락드릴게요.";

test("예전 Q27 문제(같은 답 2번)를 잡는다 (AC-144)", () => {
  assert.ok(checks([T("아직이요", "step", HANDED), T("보행기를 침대로 바꿀 수 있나요?", "question", HANDED)]).includes("repeat"));
});
test("예전 Q26 문제(지원 질문에 '무관' 답)를 잡는다 (AC-144)", () => {
  const c = checks([T("그럼 지금 지원 받을 수 있는 건 없나요?", "question", rules.replies.unrelated[0])]);
  assert.ok(c.includes("unrelated_in_care")); assert.ok(c.includes("question_ignored"));
});
test("다른 주제 질문에 '무관' 답은 문제가 아니다", () => {
  assert.deepEqual(checks([T("내일 날씨 어때요?", "unrelated", rules.replies.unrelated[0])]), []);
});
test("위급 뒤 안전 확인이 없으면 잡는다 (AC-144 · 147)", () => {
  const em = { type: "handoff", reason: "emergency" };
  assert.ok(checks([T("지난주에 넘어지셨어요", "step", "네, 알겠어요.", [em])]).includes("emergency_no_safety"));
  assert.ok(checks([T("지난주에 넘어지셨어요", "step", "급하시면 바로 119에 전화해 주세요.", [em]), T("아직이요", "step", HANDED)]).includes("emergency_no_safety"));
  assert.deepEqual(checks([T("지난주에 넘어지셨어요", "step", "급하시면 바로 119에 전화해 주세요.", [em]), T("아직이요", "step", "혹시 지금도 혼자 일어나시기 어렵거나 많이 아프세요?")]), []);
});
test("제도 정보를 출처 없이 말하면 잡는다 (AC-144)", () => {
  const p = Object.values(policy.items)[0].text;
  assert.ok(checks([T("등급이 뭐예요?", "question", p)]).includes("policy_no_source"));
  assert.ok(!checks([T("등급이 뭐예요?", "question", [p, "출처: 가상"])]).includes("policy_no_source"));
});

test("같은 시드면 같은 의심 대화 목록 (AC-146)", () => {
  const data = loadAll();
  const pickFlags = (r) => JSON.stringify(r.suspicious.map((c) => [c.index, c.flags]));
  assert.equal(pickFlags(runDemo({ n: 60, seed: 7, data })), pickFlags(runDemo({ n: 60, seed: 7, data })));
});

test("자동 시연 200번: 위급 뒤 안전 확인 없음 0건 · 실행 오류 0건, 보고서 1개 (AC-143 · 145 · 147)", () => {
  const res = runDemo({ n: 200, seed: 1 });
  assert.equal(res.convs.length, 200);
  assert.equal(res.counts.emergency_no_safety, 0);
  assert.equal(res.counts.error, 0);
  assert.match(report(res, { date: "시험" }), /# 자동 시연 보고서/);
});
