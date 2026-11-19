// 자동 시연 변형기 (Q28 · AC-143 · 146). 같은 시드면 같은 변형이 나온다.

/** 시드 난수(mulberry32). Math.random을 쓰지 않아 결과를 다시 볼 수 있다. */
export function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
export const choose = (r, list) => list[Math.floor(r() * list.length)];

// 같은 뜻의 어미 바꾸기(말투가 달라도 같은 판정이 나와야 함)
const ENDINGS = [["없어요?", "없나요?"], ["있나요?", "있어요?"], ["받아요?", "받나요?"], ["주세요", "줘요"], ["어때요?", "어떤가요?"], ["뜻이에요?", "뜻인가요?"]];

/**
 * 한 문장을 바꾼다. 무엇을 바꿨는지도 돌려준다(보고서에 적음).
 * - 물음표 빼기: 음성 인식은 물음표를 안 붙인다
 * - 띄어쓰기 1곳 붙이기 · 모두 붙이기
 * - 어미 바꾸기
 */
export function vary(text, r) {
  const how = [];
  let t = text;
  for (const [a, b] of ENDINGS) if (t.includes(a) && r() < 0.5) { t = t.replace(a, b); how.push("어미"); }
  if (t.includes("?") && r() < 0.3) { t = t.replace(/\?/g, ""); how.push("물음표 없음"); }
  const spaces = [...t.matchAll(/ /g)].map((m) => m.index);
  if (spaces.length && r() < 0.1) { t = t.replace(/ /g, ""); how.push("띄어쓰기 모두 붙임"); }
  else if (spaces.length && r() < 0.35) { const i = choose(r, spaces); t = t.slice(0, i) + t.slice(i + 1); how.push("띄어쓰기 1곳 붙임"); }
  return { text: t, how };
}
