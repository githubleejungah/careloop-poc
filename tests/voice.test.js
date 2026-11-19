// 읽기 전 다듬기: 발음 사전 · 숫자 읽기 · 질문 끝 올리기 (사용자 피드백 2026-11-19, AC-114 · 115)
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { sino, native, toSpeech, sentences, utterances } from "../site/js/voice.js";

const dict = JSON.parse(readFileSync(new URL("../site/data/pronounce.json", import.meta.url), "utf8")).words;

test("한자어 수: 6 → 육, 12 → 십이, 180 → 백팔십", () => {
  assert.equal(sino(6), "육"); assert.equal(sino(3), "삼"); assert.equal(sino(12), "십이"); assert.equal(sino(180), "백팔십");
});
test("고유어 수: 24 → 스물네", () => assert.equal(native(24), "스물네"));
test("'6개월'은 '육 개월', '3분'은 '삼 분', '24시간'은 '스물네 시간'으로 읽는다", () => {
  assert.equal(toSpeech("6개월 돌봄 점검 전화예요. 3분이면 돼요.", dict), "육 개월 돌봄 점검 전화예요. 삼 분이면 돼요.");
  assert.equal(toSpeech("상담사가 24시간 안에 연락드릴게요.", dict), "상담사가 스물네 시간 안에 연락드릴게요.");
});
test("발음 사전: A/S → 에이에스, AI → 에이아이, 119 → 백십구", () => {
  assert.equal(toSpeech("A/S 접수를 해 둘게요.", dict), "에이에스 접수를 해 둘게요.");
  assert.equal(toSpeech("이로움 AI 상담원이에요.", dict), "이로움 에이아이 상담원이에요.");
  assert.equal(toSpeech("급하시면 119에 전화해 주세요.", dict), "급하시면 백십구에 전화해 주세요.");
});
test("괄호 속 출처는 읽지 않는다", () => assert.equal(toSpeech("한도가 남았어요 (고시 제3조)", dict), "한도가 남았어요"));
test("물음표로 끝나는 문장만 질문으로 표시한다", () => {
  const s = sentences("잘 쓰고 계시다니 다행이에요. 혹시 불편하거나 고장 난 데는 없으세요?", dict);
  assert.deepEqual(s.map((x) => x.question), [false, true]);
});
test("질문은 마지막 어절만 떼어 높은 음으로 읽는다 (AC-115)", () => {
  const u = utterances("어르신은 요즘 좀 어떠세요? 달라진 점 있으세요?", dict);
  assert.deepEqual(u.map((p) => p.text), ["어르신은 요즘 좀", "어떠세요?", "달라진 점", "있으세요?"]);
  assert.ok(u[1].pitch > u[0].pitch); assert.ok(u[3].pitch > u[2].pitch);
});

test("끝 올리기는 조금만(1.12), 속도는 그대로 (시연 피드백: 기계음)", () => {
  const u = utterances("어떤 점이 제일 걱정되세요?", dict, { neural: false, rise: true });
  assert.deepEqual(u.map((p) => p.text), ["어떤 점이 제일", "걱정되세요?"]);
  assert.equal(u[1].pitch, 1.12); assert.equal(u[1].rate, u[0].rate);
});
test("신경망 목소리이거나 끝 올리기를 끄면 쪼개지 않는다", () => {
  assert.equal(utterances("어떤 점이 제일 걱정되세요?", dict, { neural: true }).length, 1);
  assert.equal(utterances("어떤 점이 제일 걱정되세요?", dict, { neural: false, rise: false }).length, 1);
});