// 요구 문서 사본(포트폴리오 04)을 원본에서 다시 만든다 (Q25 · AC-132).
// 사본은 손으로 고치지 않는다. 사본 위치는 copies.local.json(Git 제외)에 둔다.
// 실행: node scripts/sync-copies.mjs
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
export const MASTER = path.join(ROOT, "docs", "requirements.md");
const CONFIG = path.join(ROOT, "copies.local.json");

/** 사본 위치 설정. 없으면 null (다른 PC · 공개 저장소에서는 사본 점검을 건너뜀). */
export function loadCopies() {
  return existsSync(CONFIG) ? JSON.parse(readFileSync(CONFIG, "utf8")) : null;
}

/** 원본 → 사본 글. 제목 다음에 '사본' 표시 1줄만 더한다. */
export function buildCopy(master, date) {
  const lines = master.replace(/\r\n/g, "\n").split("\n");
  const note = `> **사본:** 정본은 \`${MASTER}\`. 이 파일은 포트폴리오 제출용 사본이다(${date} 동기화). 손으로 고치지 말고 \`node scripts/sync-copies.mjs\`로 다시 만든다.`;
  return [lines[0], "", note, ...lines.slice(1)].join("\n");
}

/** 사본에서 동기화 날짜를 읽는다(드리프트 점검이 날짜는 비교하지 않게). */
export const copyDate = (copy) => copy.match(/\((\d{4}-\d{2}-\d{2}) 동기화\)/)?.[1] ?? "";

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const cfg = loadCopies();
  if (!cfg?.requirements_copy) { console.log("copies.local.json에 requirements_copy가 없어 건너뜀"); process.exit(0); }
  const today = new Date(Date.now() + 9 * 3600 * 1000).toISOString().slice(0, 10); // 한국 날짜
  writeFileSync(cfg.requirements_copy, buildCopy(readFileSync(MASTER, "utf8"), today), "utf8");
  console.log(`사본 다시 만듦: ${cfg.requirements_copy}`);
}
