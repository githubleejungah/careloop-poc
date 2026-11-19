// 브라우저 내장 음성(무료). 크롬 · 엣지에서 음성 인식이 된다. 안 되면 글 상담으로 바꾼다.
// 목소리는 브라우저가 가진 한국어 목소리 중 가장 자연스러운 것을 고른다(엣지의 'Natural' 목소리 등).
const Rec = globalThis.SpeechRecognition || globalThis.webkitSpeechRecognition;
export const canListen = !!Rec;
export const canSpeak = "speechSynthesis" in globalThis;

let chosen = null;
let preferredName = null;      // 사용자가 고른 목소리
let riseEnabled = true;        // 질문 끝 올리기 켜고 끄기
function rank(v) {
  const n = v.name;
  if (/Natural/i.test(n)) return 3;            // 엣지 온라인 자연 음성
  if (/Google/i.test(n)) return 2;             // 크롬 온라인 음성
  if (/Online/i.test(n)) return 2;
  return 1;
}
export function koreanVoices() {
  return canSpeak ? speechSynthesis.getVoices().filter((v) => v.lang?.toLowerCase().startsWith("ko")).sort((a, b) => rank(b) - rank(a)) : [];
}
function chooseVoice() {
  const ko = koreanVoices();
  chosen = ko.find((v) => v.name === preferredName) ?? ko[0] ?? null;
  onChange?.();
  return chosen;
}
let onChange = null;
export function onVoicesChanged(fn) { onChange = fn; }
export function setVoice(name) { preferredName = name; chooseVoice(); }
export function setRise(on) { riseEnabled = !!on; }
export const riseOn = () => riseEnabled;
if (canSpeak) { chooseVoice(); speechSynthesis.onvoiceschanged = chooseVoice; }
export const voiceName = () => chosen?.name ?? "기본 목소리";
/** 신경망(온라인) 목소리는 물음표를 보고 스스로 끝을 올리므로 쪼개지 않는다. */
export const isNeural = (name = chosen?.name ?? "") => /Natural|Online|Google/i.test(name);

// ── 읽기 전 다듬기 ──
const DIGIT = ["", "일", "이", "삼", "사", "오", "육", "칠", "팔", "구"];
/** 한자어 수 읽기: 6 → 육, 12 → 십이, 180 → 백팔십 (개월 · 일 · 분처럼 한자어 단위 앞) */
export function sino(n) {
  if (n === 0) return "영";
  const units = [[1000, "천"], [100, "백"], [10, "십"]];
  let out = ""; let r = n;
  for (const [v, name] of units) {
    const q = Math.floor(r / v);
    if (q) { out += (q === 1 ? "" : DIGIT[q]) + name; r %= v; }
  }
  return out + DIGIT[r];
}
const NATIVE_TENS = ["", "열", "스물", "서른", "마흔", "쉰", "예순", "일흔", "여든", "아흔"];
const NATIVE_ONES = ["", "한", "두", "세", "네", "다섯", "여섯", "일곱", "여덟", "아홉"];
/** 고유어 수 읽기: 24 → 스물네 (시간처럼 고유어 단위 앞, 1~99) */
export function native(n) { return n > 0 && n < 100 ? NATIVE_TENS[Math.floor(n / 10)] + NATIVE_ONES[n % 10] : String(n); }

// 발음 사전(site/data/pronounce.json). app.js가 불러와 넣는다.
let DICT = {};
export function setDictionary(words = {}) { DICT = words; }
function applyDict(text, dict) {
  let t = text;
  for (const k of Object.keys(dict).sort((a, b) => b.length - a.length)) t = t.split(k).join(dict[k]);
  return t;
}

/** 소리로 읽을 문장으로 바꾼다. 괄호 속 내용은 읽지 않고, 발음 사전을 먼저 적용한 뒤
 *  '6개월'은 '육 개월', '24시간'은 '스물네 시간'으로 읽는다. */
export function toSpeech(text, dict = DICT) {
  return applyDict(text.replace(/\([^)]*\)/g, ""), dict)
    .replace(/(\d+)\s*(개월|주기|분|초)/g, (m, n, u) => `${sino(Number(n))} ${u}`)
    .replace(/(\d+)\s*시간/g, (m, n) => `${native(Number(n))} 시간`)
    .replace(/\s{2,}/g, " ").trim();
}
/** 문장 단위로 나누고, 물음표로 끝나는 문장은 질문으로 표시한다. */
export function sentences(text, dict = DICT) {
  return toSpeech(text, dict).split(/(?<=[.?!])\s+/).filter(Boolean)
    .map((s) => ({ text: s, question: /\?$/.test(s) }));
}

/**
 * 실제로 읽을 조각. 예전 방식(로컬) 목소리는 끝음만 올리는 기능이 없어서,
 * 질문 문장은 마지막 어절("있으세요?")만 떼어 음을 조금만 올린다.
 * 많이 올리면 기계음처럼 들린다(시연 피드백: 1.45 → 1.12로 낮춤, 속도는 그대로).
 * 신경망 목소리이거나 끝 올리기를 끄면 쪼개지 않고 문장 그대로 읽는다.
 */
export const TAIL_PITCH = 1.12;
export function utterances(text, dict = DICT, { neural = isNeural(), rise = riseEnabled } = {}) {
  const parts = [];
  for (const s of sentences(text, dict)) {
    if (!s.question || neural || !rise) { parts.push({ text: s.text, pitch: 1.0, rate: 0.97 }); continue; }
    const words = s.text.split(" ");
    const tail = words.pop();
    if (words.length) parts.push({ text: words.join(" "), pitch: 1.0, rate: 0.97 });
    parts.push({ text: tail, pitch: TAIL_PITCH, rate: 0.97 });
  }
  return parts;
}

/** 출처 줄은 읽지 않는다. */
export function speak(text) {
  if (!canSpeak || text.startsWith("출처:")) return;
  for (const p of utterances(text)) {
    const u = new SpeechSynthesisUtterance(p.text);
    u.lang = "ko-KR"; u.rate = p.rate; u.pitch = p.pitch;
    if (chosen) u.voice = chosen;
    speechSynthesis.speak(u);
  }
}
export function stopSpeaking() { if (canSpeak) speechSynthesis.cancel(); }

/** 한 번 듣고 글자로 돌려준다. */
export function listenOnce() {
  return new Promise((resolve, reject) => {
    if (!Rec) { reject(new Error("이 브라우저는 음성 인식을 지원하지 않아요. 크롬이나 엣지를 쓰거나 글로 상담해 주세요.")); return; }
    const r = new Rec();
    r.lang = "ko-KR"; r.interimResults = false; r.maxAlternatives = 1;
    r.onresult = (e) => resolve(e.results[0][0].transcript);
    r.onerror = (e) => reject(new Error(`음성 인식 오류: ${e.error}`));
    r.onend = () => resolve("");
    r.start();
  });
}
