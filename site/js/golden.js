// 골든셋 채점 (AC-67~69 · 90). 브라우저 '시험 결과' 탭과 node 시험이 같이 쓴다.
import { evaluate } from "./agent.js";
import { leaks } from "./privacy.js";

export function runGolden({ rules, policy, golden, people }) {
  const rows = [];
  for (const c of golden.cases) {
    const ctx = { rules, policy, people, remainingLimit: c.remainingLimit ?? 0 };
    const r = evaluate(c.input, ctx, { context: c.context });
    const e = c.expect;
    const checks = [];
    if ("emergency" in e) checks.push(["emergency", r.emergency, e.emergency]);
    if ("human" in e) checks.push(["human", r.human, e.human]);
    if ("scope" in e) checks.push(["scope", r.scope, e.scope]);
    if ("class" in e) checks.push(["class", r.class, e.class]);
    rows.push({ id: c.id, input: c.input, ok: checks.every(([, got, want]) => got === want), checks, got: r });
  }
  for (const c of golden.privacy) {
    const r = evaluate(c.input, { rules, policy, people }, {});
    const e = c.expect;
    const checks = [];
    if ("other_person" in e) checks.push(["other_person", r.other_person, e.other_person]);
    if ("injection" in e) checks.push(["injection", r.injection, e.injection]);
    if ("leak" in e) checks.push(["leak", leaks(r.masked, people), e.leak]);
    rows.push({ id: c.id, input: c.input, ok: checks.every(([, got, want]) => got === want), checks, got: r, privacy: true });
  }
  const em = golden.cases.filter((c) => c.expect.emergency);
  const emergencyMissed = em.filter((c) => !rows.find((r) => r.id === c.id).got.emergency).length;
  const falseEmergency = golden.cases.filter((c) => !c.expect.emergency && rows.find((r) => r.id === c.id).got.emergency).length;
  const outOfRule = golden.cases.filter((c) => c.expect.scope === "related_out");
  const directAnswered = outOfRule.filter((c) => rows.find((r) => r.id === c.id).got.scope === "in").length;
  const cls = golden.cases.filter((c) => "class" in c.expect);
  const clsOk = cls.filter((c) => rows.find((r) => r.id === c.id).got.class === c.expect.class).length;
  const privacyRows = rows.filter((r) => r.privacy);
  const leaked = privacyRows.filter((r) => !r.ok).length;
  return {
    rows,
    summary: {
      total: golden.cases.length,
      passed: rows.filter((r) => !r.privacy && r.ok).length,
      emergencyMissed, falseEmergency,
      outOfRuleDirect: directAnswered,
      classAccuracy: cls.length ? clsOk / cls.length : 1,
      classCount: cls.length,
      privacyFailed: leaked, privacyCount: privacyRows.length,
    },
  };
}
