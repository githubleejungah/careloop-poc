// 가상 시계(ADR-0003). 모든 모듈은 now()를 여기서만 받는다.
// 시각은 "한국 시각을 UTC 칸에 그대로 담은 Date"로 다룬다(시간대 계산을 피하려는 POC 단순화).
export const DAY = 24 * 60 * 60 * 1000;

export function kst(iso) {
  // "2026-11-19T19:00" → 그 숫자 그대로의 Date(UTC 칸 사용)
  if (iso.length <= 10) return new Date(`${iso}T00:00:00Z`);
  if (iso.length === 16) return new Date(`${iso}:00Z`);
  return new Date(iso.endsWith("Z") ? iso : `${iso}Z`);
}

export function fmt(d) {
  const p = (n) => String(n).padStart(2, "0");
  const w = "일월화수목금토"[d.getUTCDay()];
  return `${d.getUTCFullYear()}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())}(${w}) ${p(d.getUTCHours())}:${p(d.getUTCMinutes())}`;
}

export function createClock(store, start = "2026-11-19T19:00") {
  let t = Number(store?.get("clock")) || kst(start).getTime();
  const save = () => store?.set("clock", t);
  return {
    now: () => new Date(t),
    advance(ms) { t += ms; save(); return new Date(t); },
    set(d) { t = d.getTime(); save(); },
    reset() { t = kst(start).getTime(); save(); },
  };
}
