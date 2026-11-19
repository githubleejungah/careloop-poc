// 드리프트 점검 (Q25 · AC-131 · 132). 원본과 사본 · 코드 · 문서 숫자가 어긋나면 실패한다.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, existsSync } from "node:fs";
import path from "node:path";
import { ROOT, MASTER, loadCopies, buildCopy, copyDate } from "../scripts/sync-copies.mjs";

const read = (p) => readFileSync(path.join(ROOT, p), "utf8");
const req = readFileSync(MASTER, "utf8");
const golden = JSON.parse(read("site/data/golden_set.json"));
const DOCS = ["README.md", "CLAUDE.md", ...readdirSync(path.join(ROOT, "docs")).filter((f) => f.endsWith(".md")).map((f) => `docs/${f}`)];

test("상담 시간 · 불만 기한을 코드에 다시 쓰지 않는다 — rules.json 한 곳만 (AC-131)", () => {
  const BAD = [/평일\s*10\s*~\s*16시/, /\bopen:\s*10\b/, /\bclose:\s*16\b/, /\b24\s*\*\s*HOUR\b/, /setUTCHours\(\s*(10|16)\b/];
  const hits = [];
  for (const f of readdirSync(path.join(ROOT, "site/js"))) {
    const src = read(`site/js/${f}`);
    for (const re of BAD) if (re.test(src)) hits.push(`${f}: ${re}`);
  }
  assert.deepEqual(hits, []);
});

test("수용 기준 개수: 표 행 수 = 6-2 집계 = 상태 줄 = README (AC-132)", () => {
  const rows = [...req.matchAll(/^\| AC-\d+ \| (\w) \| (\w+) \|/gm)];
  const n = rows.length;
  const totals = [...req.matchAll(/\(합 (\d+)\)/g)].map((m) => Number(m[1]));
  assert.deepEqual(totals, [n, n], "6-2 집계 합");
  const pat = req.match(/\| 패턴 U · E · S · O · W \| ([\d · ]+) \(/)[1].split(" · ").map(Number);
  const cnt = (k) => rows.filter((r) => r[1] === k).length;
  assert.deepEqual(pat, ["U", "E", "S", "O", "W"].map(cnt), "패턴별 개수");
  assert.equal(Number(req.match(/수용 기준 (\d+)개\(/)[1]), n, "상태 줄");
  for (const f of DOCS) for (const m of read(f).matchAll(/수용 기준 (\d+)개/g)) assert.equal(Number(m[1]), n, `${f}의 '${m[0]}'`);
});

/** '골든셋 N개'는 실제 개수와 같아야 하고, '50개 이상'처럼 최소 기준이면 실제가 그 이상이어야 한다. */
function checkGoldenNumbers(text, where) {
  const actual = golden.cases.length;
  for (const m of text.matchAll(/골든셋\s*\(?(\d+)개(\s*이상)?/g)) {
    const k = Number(m[1]);
    if (m[2]) assert.ok(actual >= k, `${where}: '${m[0]}'인데 실제 ${actual}개`);
    else assert.equal(k, actual, `${where}: '${m[0]}'인데 실제 ${actual}개`);
  }
}

test("골든셋 개수: 문서에 적힌 숫자가 실제 파일과 맞는다 (AC-132)", () => {
  for (const f of DOCS) if (f !== "docs/requirements.md") checkGoldenNumbers(read(f), f);
  // 요구 문서는 인터뷰 기록(3절)은 당시 말 그대로 두고, 수용 기준(6절)만 본다
  checkGoldenNumbers(req.slice(req.indexOf("## 6.")), "requirements 6절");
  const m = read("README.md").match(/전체 (\d+)\/(\d+)/);
  if (m) assert.equal(Number(m[2]), golden.cases.length, "README 골든셋 결과");
});

test("요구 사본이 원본과 같다 (AC-132)", (t) => {
  const cfg = loadCopies();
  if (!cfg?.requirements_copy || !existsSync(cfg.requirements_copy)) return t.skip("copies.local.json 없음 — 이 PC에는 사본이 없다");
  const copy = readFileSync(cfg.requirements_copy, "utf8").replace(/\r\n/g, "\n");
  assert.ok(copy === buildCopy(req, copyDate(copy)), "사본이 원본과 다름 → node scripts/sync-copies.mjs");
});

test("포트폴리오 슬라이드의 골든셋 숫자도 실제와 맞는다 (AC-132)", (t) => {
  const cfg = loadCopies();
  if (!cfg?.slides_script || !existsSync(cfg.slides_script)) return t.skip("슬라이드 스크립트 없음");
  checkGoldenNumbers(readFileSync(cfg.slides_script, "utf8"), "build_portfolio.js");
});
