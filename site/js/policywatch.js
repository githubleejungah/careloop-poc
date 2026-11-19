// 제도 변경 자동 점검 (AC-80 · 91~99 · 108). 사람 승인을 대신하지 않고 돕는다.
export const GRACE_WORDS = ["경과조치", "적용례", "유예", "종전의 규정", "다만"];

const dateOf = (y, m, d) => `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
const numbers = (t) => (String(t).match(/\d[\d,]*(?:\.\d+)?/g) || []).map((n) => n.replace(/,/g, ""));

/** 부칙에서 시행일을 뽑는다. 조항별 시행일도 나눈다 (AC-91 · 93). */
export function extractDates(text, meta = {}) {
  const effective = [];
  const main = text.match(/(?:이 고시|이 법|이 규칙)[은는]\s*(\d{4})년\s*(\d{1,2})월\s*(\d{1,2})일부터 시행/);
  if (main) effective.push({ scope: "전체", date: dateOf(main[1], main[2], main[3]) });
  if (/공포한 날부터 시행/.test(text) && meta.promulgated) effective.push({ scope: "전체", date: meta.promulgated });
  for (const m of text.matchAll(/다만,?\s*(제\d+조[^은는]*)[은는]?\s*(?:개정규정은\s*)?(\d{4})년\s*(\d{1,2})월\s*(\d{1,2})일부터 시행/g)) {
    effective.push({ scope: m[1].replace(/의$/, "").trim(), date: dateOf(m[2], m[3], m[4]) });
  }
  return { promulgated: meta.promulgated ?? null, effective };
}

/** 유예 관련 표현 5가지를 찾는다 (AC-94). */
export function graceHits(text) {
  const hits = [];
  for (const w of GRACE_WORDS) {
    let i = text.indexOf(w);
    while (i >= 0) { hits.push({ word: w, around: text.slice(Math.max(0, i - 15), i + w.length + 25) }); i = text.indexOf(w, i + 1); }
  }
  return hits;
}

/** 요약 문장마다 원문 인용이 실제로 있는지 (AC-95). */
export function quoteCheck(summary, newText) {
  return summary.map((s) => ({ claim: s.claim, quote: s.quote, ok: newText.includes(s.quote) }));
}

/** 요약 속 숫자가 원문 숫자와 같은지 (AC-96). */
export function numberCheck(summary, newText) {
  const src = new Set(numbers(newText));
  return summary.map((s) => {
    const bad = numbers(s.claim).filter((n) => !src.has(n));
    return { claim: s.claim, ok: bad.length === 0, mismatch: bad };
  });
}

/** 서로 다른 방식의 요약 2개 비교 (AC-97): 숫자 묶음이 다르면 다름. */
export function twoSummaryDiff(a, b) {
  const key = (sum) => sum.flatMap((s) => numbers(s.claim)).sort().join(",");
  return key(a) !== key(b);
}

/** 점검 보고서. reported: 이미 보고한 [notice_id, revised_at] 목록 (AC-108). */
export function analyze(sample, reported = []) {
  const { meta, new_text, summaries } = sample;
  if (reported.some((r) => r.notice_id === meta.notice_id && r.revised_at === meta.revised_at)) {
    return { duplicate: true, notice_id: meta.notice_id, revised_at: meta.revised_at };
  }
  const dates = extractDates(new_text, meta);
  const grace = graceHits(new_text);
  const quotes = quoteCheck(summaries[0], new_text);
  const nums = numberCheck(summaries[0], new_text);
  const diff = summaries.length > 1 ? twoSummaryDiff(summaries[0], summaries[1]) : false;
  const reasons = [];
  if (dates.effective.length === 0) reasons.push("시행일을 찾지 못함");
  if (grace.length) reasons.push(`유예 관련 표현 ${grace.length}건`);
  if (quotes.some((q) => !q.ok)) reasons.push("원문에 없는 인용");
  if (nums.some((n) => !n.ok)) reasons.push("원문과 다른 숫자");
  const red = reasons.length > 0;
  if (diff) reasons.push("두 요약이 서로 다름");
  return {
    duplicate: false, notice_id: meta.notice_id, revised_at: meta.revised_at, topics: meta.topics ?? [],
    promulgated: dates.promulgated, effective: dates.effective, grace_hits: grace,
    quote_check: quotes, number_check: nums, two_summary_diff: diff,
    level: red ? "red" : diff ? "yellow" : "green", reasons, status: "pending",
    can_apply: !red, // 빨강은 담당자 확인 전 반영 0건 (AC-99)
  };
}
