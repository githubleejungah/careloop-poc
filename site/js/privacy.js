// 가명 처리(AC-84 · 89): 이름 · 연락처 · 주소 · 요양인정번호를 가명으로 바꾼다.
// 이후 모듈은 가명 문장만 본다. 원문은 저장하지 않는다.

const PHONE = /01[0-9][-\s.]?\d{3,4}[-\s.]?\d{4}/g;
const CERT = /\bL?\d{10}\b/g;
const ADDRESS = /[가-힣]{1,6}(?:시|도)\s?[가-힣]{1,6}(?:구|군)\s?[가-힣0-9]{1,10}(?:동|로|길|읍|면)(?:\s?\d+(?:-\d+)?)?/g;

/** people: seed.people 같은 목록. 이름을 알고 있으면 그 이름을 가린다. */
export function mask(text, people = []) {
  const map = {};
  let n = { 이름: 0, 전화: 0, 주소: 0, 번호: 0 };
  const token = (kind, raw) => {
    const hit = Object.entries(map).find(([, v]) => v === raw);
    if (hit) return hit[0];
    n[kind] += 1;
    const key = `[${kind}${n[kind]}]`;
    map[key] = raw;
    return key;
  };
  let out = String(text ?? "");
  out = out.replace(PHONE, (m) => token("전화", m));
  out = out.replace(ADDRESS, (m) => token("주소", m));
  out = out.replace(CERT, (m) => token("번호", m));
  const names = new Set();
  for (const p of people) {
    if (p.name) names.add(p.name);
    if (p.elder?.name) names.add(p.elder.name);
  }
  for (const name of [...names].sort((a, b) => b.length - a.length)) {
    if (out.includes(name)) out = out.split(name).join(token("이름", name));
  }
  return { masked: out, map };
}

/** 문장에 가리지 않은 개인정보가 남아 있는지(유출 검사, AC-90). */
export function leaks(text, people = []) {
  const s = String(text ?? "");
  if (new RegExp(PHONE.source).test(s)) return true;
  if (new RegExp(CERT.source).test(s)) return true;
  if (new RegExp(ADDRESS.source).test(s)) return true;
  for (const p of people) {
    for (const v of [p.name, p.phone, p.elder?.name, p.elder?.cert_no, p.elder?.address]) {
      if (v && s.includes(v)) return true;
    }
  }
  return false;
}
