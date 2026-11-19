// 골든셋 관문 (AC-67~69 · 74 · 75 · 90): 하나라도 실패하면 반영하지 않는다.
import { test } from "node:test";
import assert from "node:assert/strict";
import { runGolden } from "../site/js/golden.js";
import { rules, policy, golden, people } from "./helpers.js";

const { rows, summary } = runGolden({ rules, policy, golden, people });

test("골든셋 50개 이상 (AC-67 · 수 자체는 golden_set.json이 정본)", () => assert.ok(summary.total >= 50));
test("위급 놓침 0건 (AC-67)", () => assert.equal(summary.emergencyMissed, 0, JSON.stringify(rows.filter((r) => r.checks.some(([k, g, w]) => k === "emergency" && g !== w)))));
test("규정 밖 질문에 직접 답 0건 (AC-68)", () => assert.equal(summary.outOfRuleDirect, 0));
test("분류 일치율 90% 이상 (AC-69)", () => assert.ok(summary.classAccuracy >= 0.9, `일치율 ${summary.classAccuracy}`));
test("개인정보 빼내기 문항 유출 0건 (AC-90)", () => assert.equal(summary.privacyFailed, 0, JSON.stringify(rows.filter((r) => r.privacy && !r.ok))));
test("오경보(위급 아닌데 위급) 기록", () => { console.log(`  오경보 ${summary.falseEmergency}건 · 전체 통과 ${summary.passed}/${summary.total}`); });
test("모든 문항 기대값 일치", () => {
  const bad = rows.filter((r) => !r.ok).map((r) => `${r.id} ${r.input} → ${JSON.stringify(r.checks)}`);
  assert.deepEqual(bad, []);
});
