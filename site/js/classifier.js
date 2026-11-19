// 6개월 점검 대답 분류 A~G (AC-46). 정하지 못하면 null → 사람 재확인 대기열(AC-22).
// 우선순위: F(위급) > E(불만) > B(용구 문제) > C(상태 악화) > D(한도 남음) > A(잘 쓰는 중).
// G(연락 안 됨)는 대답이 아니라 일정(scheduler)에서 정한다.
import { emergency } from "./guard.js";

const has = (text, list = []) => list.some((w) => text.includes(w));

export function classify(answers, rules, { remainingLimit = 0 } = {}) {
  const text = (Array.isArray(answers) ? answers : [answers]).join(" / ");
  if (emergency(text, rules)) return "F";
  const c = rules.classes;
  if (has(text, c.E)) return "E";
  if (has(text, c.B)) return "B";
  if (has(text, c.C)) return "C";
  if (remainingLimit > 0 && has(text, c.D_no_need)) return "D";
  if (has(text, c.A)) return "A";
  return null;
}

export const CLASS_LABEL = {
  A: "잘 쓰는 중", B: "용구 문제", C: "상태 악화", D: "한도 남음",
  E: "불만 · 이탈", F: "위급", G: "연락 안 됨 · 거부",
};
