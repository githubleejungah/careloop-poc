// 판정 하네스: 위급 → 사람 요청 → 규칙 무시 요구 → 다른 사람 정보 → 범위 순서로 본다.
// 위급 규칙은 설정으로 끌 수 없다(AC-18): 이 파일에는 끄는 옵션이 없다.

// 띄어쓰기를 빼고 비교한다: '지원 받을' = '지원받을', '못일어나' = '못 일어나' (AC-133)
const squash = (t) => t.replace(/\s+/g, "");
const has = (text, list = []) => { const t = squash(text); return list.some((w) => t.includes(squash(w))); };

/** 위급 신호 5종 중 하나를 돌려준다. 없으면 null (AC-16). */
export function emergency(text, rules) {
  for (const [category, words] of Object.entries(rules.emergency)) {
    if (has(text, words)) return category;
  }
  return null;
}

export function wantsHuman(text, rules) { return has(text, rules.human_request); }
export function isInjection(text, rules) { return has(text, rules.injection); }
export function asksOtherPerson(text, rules) {
  return has(text, rules.other_person.who) && has(text, rules.other_person.what);
}
export function isYes(text, rules) { return !has(text, rules.no) && has(text, rules.yes); }
export function isNo(text, rules) { return has(text, rules.no); }
export function behaviorSigns(text, rules) { return has(text, rules.behavior_signs); }

/**
 * 범위 판정 (AC-09~13 · 81).
 * - in: 승인된 규정 안 + 정본 근거가 있음
 * - related_out: 이로움과 관련 있지만 규정 밖, 근거 없음, 또는 애매함(관련 있음으로 본다)
 * - unrelated: 무관
 */
export function scope(text, rules, policy) {
  for (const r of rules.in_rules) {
    if (has(text, r.keywords)) {
      if (rules.pending_policy_topics?.includes(r.id)) return { scope: "pending", rule: r };
      const grounded = r.answer || (r.policy && policy.items[r.policy]);
      return grounded ? { scope: "in", rule: r } : { scope: "related_out", reason: "no_source" };
    }
  }
  if (has(text, rules.related)) return { scope: "related_out", reason: "out_of_rule" };
  // 애매함: 질문처럼 보이고 돌봄과 닿는 말이 섞이면 관련으로 본다(AC-13)
  if (/어머|아버|부모|할머|할아|어르신|돌봄|간병/.test(text)) return { scope: "related_out", reason: "ambiguous" };
  return { scope: "unrelated" };
}

/** 정본(policy.json)에서만 답을 만든다. 기준 고시 · 날짜를 함께 붙인다(AC-44 · 83). */
export function groundedAnswer(rule, policy) {
  if (rule.answer) return { text: rule.answer, sources: [] };
  const ids = [rule.policy, rule.also].filter(Boolean);
  const items = ids.map((id) => policy.items[id]).filter(Boolean);
  const text = items.map((it) => it.text).join(" ");
  // 같은 출처는 한 번만 (AC-151): 5등급 · 인지지원등급처럼 두 항목의 출처가 같을 수 있다
  const sources = [...new Set(items.map((it) => `${it.source} · ${it.as_of} 기준${it.verified ? "" : " · 확인 필요"}`))];
  return { text, sources };
}

/** 상담 시간인지 (AC-17 · 24). when은 Date. */
export function inCounselHours(when, rules, holidays = []) {
  const h = rules.handoff.counsel_hours;
  const iso = when.toISOString().slice(0, 10);
  if (holidays.includes(iso)) return false;
  if (!h.weekdays.includes(when.getUTCDay())) return false;
  const hour = when.getUTCHours();
  return hour >= h.start && hour < h.end;
}
