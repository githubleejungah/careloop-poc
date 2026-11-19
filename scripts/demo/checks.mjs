// 자동 시연 이상 패턴 검사기 6가지 (Q28 · Q30 · AC-144 · 147 · 152).
// turns: [{ input, tag, say: [..], choices: [..], actions: [..] }] — 고객 한마디와 AI 대답 한 쌍씩.

export const CHECKS = {
  repeat: "같은 답 연속",
  unrelated_in_care: "돌봄 대화 중 '무관' 답",
  question_ignored: "질문에 답 없이 넘어감",
  emergency_no_safety: "위급 뒤 안전 확인 없음",
  policy_no_source: "출처 없는 제도 안내",
  source_duplicate: "출처 줄에 같은 출처 중복",
};
export const HARD = ["emergency_no_safety", "error"]; // 1건이라도 나오면 시험 실패 (AC-147)

const anyIn = (text, list = []) => list.some((x) => text.includes(x));
const SAFE = /119|일어나시기|아프|위험|힘든|다행|연결해 드릴게요/;

/** 대화 1개를 검사해 의심 목록을 돌려준다. { check, turn } */
export function inspect(turns, { rules, policy }) {
  const R = rules.replies;
  const found = [];
  const flag = (check, turn) => found.push({ check, turn });
  const policyTexts = Object.values(policy.items).map((it) => it.text.slice(0, 15));
  let emergencyAt = -1;

  turns.forEach((t, i) => {
    const said = t.say.join(" ");
    // 1. 같은 답 연속 (AC-142)
    if (i > 0 && said && said === turns[i - 1].say.join(" ")) flag("repeat", i);
    // 2. 돌봄 대화 중 '무관' 답: 엉뚱한 주제로 넣은 말이 아닌데 무관 답이 나옴 (AC-136)
    if (t.tag !== "unrelated" && anyIn(said, R.unrelated)) flag("unrelated_in_care", i);
    // 3. 질문 · 요청에 답 없이 넘어감: 못 알아들음 · 무관 · '앞과 같아요'로 답함
    if ((t.tag === "question" || t.tag === "request") && (!said || anyIn(said, [...R.misunderstand, ...R.unrelated, "앞에서 말씀드린 내용과 같아요"]))) flag("question_ignored", i);
    // 4. 위급 뒤 안전 확인: 위급 대답 자체와, 그 뒤 질문이 아닌 첫 말에 대한 대답 (AC-17 · 138)
    const isEmergency = t.actions.some((a) => a.type === "handoff" && a.reason === "emergency");
    if (isEmergency) { if (!SAFE.test(said)) flag("emergency_no_safety", i); emergencyAt = i; }
    else if (emergencyAt >= 0 && emergencyAt === i - 1 && !["question", "request", "unrelated"].includes(t.tag) && !SAFE.test(said)) flag("emergency_no_safety", i);
    // 5. 제도 정보 문장을 말했는데 '출처:' 줄이 없음 (AC-44 · 83)
    if (policyTexts.some((p) => said.includes(p)) && !t.say.some((l) => l.startsWith("출처:"))) flag("policy_no_source", i);
    // 6. 출처 줄에 같은 출처가 두 번 (AC-151 · 152)
    for (const l of t.say.filter((x) => x.startsWith("출처:"))) {
      const parts = l.replace(/^출처:\s*/, "").split(" / ");
      if (new Set(parts).size < parts.length) flag("source_duplicate", i);
    }
  });
  return found;
}
