// 자동 시연 (Q28 · AC-143~147). 사람이 대화를 쳐 보는 대신, 문장을 바꿔 가며 대화를 여러 번 돌리고
// 이상 패턴 6가지로 의심 대화만 보고서에 모은다. 비용 0원, 사이트에는 들어가지 않는 개발 도구.
// 실행: npm run demo  (또는 node scripts/demo/run.mjs --n 200 --seed 1)
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { createSession, start, reply } from "../../site/js/agent.js";
import { kst } from "../../site/js/clock.js";
import { rng, choose, vary } from "./variants.mjs";
import { inspect, CHECKS, HARD } from "./checks.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const load = (p) => JSON.parse(readFileSync(path.join(ROOT, p), "utf8"));
const MAX_TURNS = 12;

export function loadAll() {
  return { rules: load("site/data/rules.json"), policy: load("site/data/policy.json"), holidays: load("site/data/holidays.json").dates,
    seed: load("site/data/seed.json"), plan: load("scripts/demo/scenarios.json") };
}

/** 대화 1개를 돌린다. 시나리오 단계 사이에 끼워 넣을 말 · 선택지 누르기를 무작위로 섞는다. */
function oneConversation(r, data, index) {
  const { rules, policy, holidays, seed, plan } = data;
  const sc = choose(r, plan.scenarios);
  const when = choose(r, ["in_hours", "out_hours"]);
  const channel = choose(r, ["text", "voice"]);
  const person = seed.people.find((p) => p.id === sc.person);
  const order = sc.order ? seed.orders.find((o) => o.id === sc.order) : undefined;
  const ctx = { rules, policy, holidays, people: seed.people, now: kst(plan.times[when]), person, order, providerConsent: r() < 0.5 };
  const s = createSession({ kind: sc.kind, channel, person, now: ctx.now });
  const conv = { index, scenario: sc.id, when, channel, turns: [], errors: [] };
  let last = start(s, ctx);
  conv.opening = last.say;

  const queue = sc.steps.map((alts) => ({ text: choose(r, alts), tag: "step" }));
  for (let k = 0, extra = r() < 0.5 ? 1 + Math.floor(r() * 2) : 0; k < extra; k++) queue.push({ ...choose(r, plan.inserts) }); // 끝난 뒤 말 (Q23 · Q27)
  while (queue.length && conv.turns.length < MAX_TURNS) {
    let next;
    if (r() < 0.3) next = { ...choose(r, plan.inserts) };                                   // 중간에 끼워 넣기
    else if (last.choices?.length && r() < 0.25) next = { text: choose(r, last.choices), tag: "choice" }; // 선택지 누르기
    else next = queue.shift();
    const v = next.tag === "choice" ? { text: next.text, how: [] } : vary(next.text, r);
    try {
      const stateBefore = s.state;
      last = reply(s, v.text, ctx);
      conv.turns.push({ state: stateBefore, input: v.text, original: next.text, tag: next.tag, how: v.how, say: last.say, choices: last.choices ?? [], actions: last.actions ?? [] });
    } catch (e) {
      conv.errors.push({ input: v.text, message: String(e?.message ?? e) });
      break;
    }
  }
  conv.flags = inspect(conv.turns, { rules, policy });
  if (conv.errors.length) conv.flags.push({ check: "error", turn: conv.turns.length });
  return conv;
}

/** 자동 시연 전체. 같은 seed면 같은 결과 (AC-146). */
export function runDemo({ n = 200, seed = 1, data = loadAll() } = {}) {
  const r = rng(seed);
  const convs = Array.from({ length: n }, (_, i) => oneConversation(r, data, i + 1));
  const counts = Object.fromEntries([...Object.keys(CHECKS), "error"].map((k) => [k, 0]));
  for (const c of convs) for (const f of c.flags) counts[f.check] += 1;
  const suspicious = convs.filter((c) => c.flags.length);
  return { n, seed, convs, suspicious, counts, hard: HARD.reduce((a, k) => a + counts[k], 0) };
}

const TAG = { step: "", choice: "선택지", question: "질문", request: "요청", correction: "말 바꿈", insist: "되풀이", filler: "엉뚱한 말", unrelated: "다른 주제" };

/** 보고서(마크다운). 의심 대화만, 검사별로 앞의 몇 개만 보여 준다 (AC-145). */
export function report(res, { perCheck = 3, date } = {}) {
  const L = [];
  L.push(`# 자동 시연 보고서 ${date}`, "");
  L.push(`대화 ${res.n}번 · 시드 ${res.seed} · 의심 대화 ${res.suspicious.length}개 · 반드시 고칠 것(위급 · 오류) ${res.hard}건`, "");
  L.push("같은 시드로 다시 돌리면 같은 결과가 나온다: `node scripts/demo/run.mjs --n " + res.n + " --seed " + res.seed + "`", "");
  L.push("## 검사별 건수", "", "| 검사 | 건수 |", "|---|---|");
  for (const [k, label] of Object.entries({ ...CHECKS, error: "실행 오류" })) L.push(`| ${label} | ${res.counts[k]} |`);
  L.push("", "## 의심 대화 (사람이 진짜 문제인지 판정)", "");
  L.push("진짜 문제면 `tests/dialog.test.js`에 고정한 뒤 요구 → 코드 순으로 고친다. 아니면 검사기 기준(`scripts/demo/checks.mjs`)을 고친다.", "");
  for (const [k, label] of Object.entries({ ...CHECKS, error: "실행 오류" })) {
    const list = res.suspicious.filter((c) => c.flags.some((f) => f.check === k));
    if (!list.length) continue;
    L.push(`### ${label} — ${list.length}개 중 ${Math.min(perCheck, list.length)}개`, "");
    for (const c of list.slice(0, perCheck)) {
      const bad = new Set(c.flags.filter((f) => f.check === k).map((f) => f.turn));
      L.push(`**대화 #${c.index}** · ${c.scenario} · ${c.when === "in_hours" ? "상담 시간 안" : "상담 시간 밖"} · ${c.channel === "voice" ? "말로" : "글로"}`, "");
      L.push(`- AI: ${c.opening.join(" ")}`);
      c.turns.forEach((t, i) => {
        const note = [TAG[t.tag], ...t.how].filter(Boolean).join(", ");
        L.push(`- 고객: ${t.input}${note ? ` _(${note})_` : ""} · 단계 \`${t.state}\``);
        L.push(`  ${bad.has(i) ? "**⚠ AI:**" : "- AI:"} ${t.say.join(" ")}`);
      });
      for (const e of c.errors) L.push(`- **오류:** "${e.input}" → ${e.message}`);
      L.push("");
    }
  }
  return L.join("\n");
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const arg = (name, d) => { const i = process.argv.indexOf(`--${name}`); return i > 0 ? Number(process.argv[i + 1]) : d; };
  const res = runDemo({ n: arg("n", 200), seed: arg("seed", 1) });
  const date = new Date(Date.now() + 9 * 3600 * 1000).toISOString().slice(0, 10); // 한국 날짜
  mkdirSync(path.join(ROOT, "reports"), { recursive: true });
  const file = path.join(ROOT, "reports", `시연_${date}.md`);
  writeFileSync(file, report(res, { date }), "utf8");
  console.log(`대화 ${res.n}번 · 의심 ${res.suspicious.length}개 · 반드시 고칠 것 ${res.hard}건`);
  console.log(Object.entries(res.counts).map(([k, v]) => `${k}=${v}`).join(" "));
  console.log(`보고서: ${file}`);
  process.exitCode = res.hard ? 1 : 0;
}
