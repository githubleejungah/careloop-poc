// AI 상담원(모의). 정해진 상태 순서로 움직인다(ADR-0001).
// 운영에서는 이 파일만 LLM 상담원으로 바꾸고, guard · privacy · classifier · 골든셋은 그대로 둔다.
// 말투 규칙(rules.json replies_note): 한 번에 한 가지, 짧게, 맞장구 먼저. 출처는 '출처:' 줄로 따로.
import { mask } from "./privacy.js";
import * as G from "./guard.js";
import { classify } from "./classifier.js";
import { SLOTS, computeDue, KIND_DAYS } from "./scheduler.js";
import { hoursLabel, dueFor } from "./tasks.js";

const out = (say = [], choices = [], actions = []) => ({ say: [].concat(say).filter(Boolean), choices, actions });
const QUESTION = /\?|얼마|어떻게|왜|무엇|뭐|언제|어디|며칠|몇 ?시|되나요|있나요|인가요|할 수 있|해 줄 수|돼요\?|줄 수/; // 음성은 물음표가 없어 의문사도 본다(Q29)
const has = (text, list = []) => { const t = text.replace(/\s+/g, ""); return list.some((w) => t.includes(w.replace(/\s+/g, ""))); };
// 말 바꿈: 진단 질문에 '아직'이라고 한 뒤 검사 · 진단을 받았다고 고치는 말 (AC-134)
const CORRECTION = /(검사|진단)[^?]*(받았|받으셨|받았어|했어|하셨|마쳤|나왔)/;
// 되풀이 표현: 고객이 같은 말을 다시 하게 됐다는 신호 (AC-137)
const INSIST = /다니까|라니까|했잖아|말했잖|드렸잖|그랬잖|아까 말/;

/** 같은 뜻의 변형 중 하나. 상담 안에서 그 말을 쓴 횟수로 번갈아 고르므로 결과가 매번 같다. */
export function pick(s, rules, key) {
  const v = rules.replies[key];
  const list = Array.isArray(v) ? v : [v];
  if (!s) return list[0];
  s.picks ??= {};
  s.picks[key] = (s.picks[key] ?? -1) + 1;
  return list[s.picks[key] % list.length];
}
const SOURCE = "출처: ";
function sourceLine(sources) { return sources.length ? SOURCE + sources.join(" / ") : null; }

export function createSession({ kind, channel, person, now }) {
  return {
    id: `S-${now.getTime().toString(36)}`, kind, channel, person_id: person.id,
    state: "start", turns: [], answers: [], misunderstand: 0, rejected: {},
    class: null, handoff: null, repeat_explain_count: 0, latency_ms: [],
    created_at: now.toISOString(), offered_recheck: false, resume: null,
  };
}

function summary(s) {
  return s.turns.filter((t) => t.who === "customer").slice(-3).map((t) => t.text).join(" / ");
}
// AI가 이미 한 안내를 상담사에게 보여 주려고 남긴다(Q24 · AC-126). 같은 말을 되풀이하지 않게.
const NOTICE_PATTERNS = [
  [/119/, "119 안내함"], [/치매안심센터/, "치매안심센터 · 검사비 안내함"], [/5등급|인지지원등급/, "5등급 · 인지지원등급 기준 안내함"],
  [/공공 지원/, "등급 없이 받는 공공 지원 안내함"], [/A\/S 접수/, "A/S 접수함"], [/사업소에 그대로 전해/, "사업소에 내용 전달함"],
  [/24시간 안에/, "24시간 안 연락을 약속함"], [/다음 영업일에 상담사가 먼저/, "다음 영업일 연락을 약속함"],
  [/올해 복지용구 한도는/, "남은 한도 안내함"], [/요청 보냈어요/, "용구 상담 요청 접수함"],
];
function sayAI(s, lines) {
  s.notices ??= [];
  for (const l of [].concat(lines)) {
    s.turns.push({ who: "ai", text: l });
    for (const [re, label] of NOTICE_PATTERNS) if (re.test(l) && !s.notices.includes(label)) s.notices.push(label);
  }
}

/** 상담 시작 문장 (AC-06 · 07 · 41). */
export function start(s, ctx) {
  const R = ctx.rules;
  const hello = pick(s, R, s.channel === "voice" ? "greeting_voice" : "greeting_text");
  let o;
  if (s.kind === "grade_out") {
    s.state = "free";
    o = out([hello, "결과 보시고 많이 놀라셨죠. 어떤 점이 제일 걱정되세요?"]);
  } else if (s.kind === "checkup_6m") {
    s.state = "q1";
    const item = ctx.order?.item ?? "복지용구";
    o = out([hello, "6개월 돌봄 점검 전화예요. 3분이면 돼요.", `요즘도 ${item} 잘 쓰고 계세요?`]);
  } else {
    s.state = "r1";
    o = out([hello, "3개월 전에 다시 연락드리기로 했던 재검사 안내예요.", "예상 테스트를 한 번 더 해 보시겠어요? 링크를 보내 드릴게요."], ["네", "아니요"]);
  }
  sayAI(s, o.say);
  return o;
}

function handoff(s, ctx, reason, urgent = false) {
  s.handoff = reason;
  const R = ctx.rules;
  const open = G.inCounselHours(ctx.now, R, ctx.holidays);
  s.handoff_at = ctx.now.toISOString(); s.handoff_open = open; // 넘긴 뒤 연락 시각을 말할 때 쓴다(AC-138)
  const actions = [{ type: "handoff", reason, urgent, summary: summary(s), in_hours: open }];
  let say;
  if (urgent && !open) {
    say = pick(s, R, "emergency_closed");
    actions.push({ type: "callback", reason, when: "next_business_day" });
  } else if (urgent) {
    say = pick(s, R, "emergency_open");
  } else if (open) {
    say = "네, 상담사에게 바로 연결해 드릴게요. 지금까지 말씀하신 내용은 함께 넘겨 드려서, 다시 설명하지 않으셔도 돼요.";
  } else {
    say = `지금은 상담사가 없는 시간(${hoursLabel(R)} 상담)이라, 다음 영업일에 상담사가 먼저 연락드릴게요. 말씀하신 내용은 함께 넘겨 드릴게요.`;
    actions.push({ type: "callback", reason, when: "next_business_day" });
  }
  s.state = "ended";
  return out(say, [], actions);
}

/** 고객 한마디 처리. 하네스 순서: 가명 → 위급 → 사람 요청 → 규칙 무시 → 다른 사람 → 상태별 → 범위. */
export function reply(s, input, ctx) {
  const { masked } = mask(input, ctx.people ?? []);
  s.turns.push({ who: "customer", text: masked });
  const o = route(s, masked, ctx);
  if (INSIST.test(masked) && !String(o.say[0] ?? "").includes("죄송")) o.say.unshift("제가 앞에서 잘못 알아들었나 봐요. 죄송해요.");
  // 같은 안내를 연속 2번 하지 않는다 (AC-142)
  const said = o.say.join(" / ");
  // 같은 질문을 다시 하면 이해를 못 한 것이므로 '다시 말씀드릴게요'를 붙여 다시 답한다 (AC-150)
  if (said && said === s.last_said) o.say = ["다시 말씀드릴게요.", ...o.say];
  s.last_said = o.say.join(" / ");
  sayAI(s, o.say);
  return o;
}

function route(s, text, ctx) {
  const R = ctx.rules;
  // 위급 · 사람 요청은 상담이 끝난 뒤에도 늘 먼저 본다.
  const em = G.emergency(text, R);
  if (em) { s.class = "F"; s.emergency = em; return handoff(s, ctx, "emergency", true); }
  if (G.wantsHuman(text, R) || text.includes("상담사와 상의")) return handoff(s, ctx, "request");

  // 상담이 한 번 끝나도 고객이 더 물으면 이어서 답한다(시연 피드백 Q23). 사람에게 넘긴 상담만 안내로 답한다.
  if (G.isInjection(text, R)) return out(pick(s, R, "injection"));
  if (G.asksOtherPerson(text, R)) return out(pick(s, R, "other_person"));
  // 사람에게 넘긴 뒤에도 듣고 답한다(Q27). 넘기지 않은 상담은 이어서 답한다(Q23).
  if (s.state === "ended" && s.handoff) return afterHandoff(s, text, ctx);
  if (s.state === "ended") { s.state = "followup"; s.offered_recheck = true; }

  if (s.dx_answer === "not_yet" && CORRECTION.test(text) && !isRealQuestion(text)) return onCorrection(s, text, ctx);

  if (s.state === "await_choice") return onChoice(s, text, ctx);
  if (s.state === "await_buttons") return onButtons(s, text, ctx);

  const handler = STATES[s.state];
  if (handler) return handler(s, text, ctx);
  return free(s, text, ctx);
}

// ── 범위 판정이 필요한 자유 질문 ──
function free(s, text, ctx) {
  const R = ctx.rules;
  if (isContactQuestion(text)) return out(contactAnswer(s, ctx));
  const sc = G.scope(text, R, ctx.policy);
  if (sc.scope === "unrelated") {
    // '무관' 답은 다른 주제의 질문일 때만. 상담 중 질문이 아닌 말은 못 알아들은 것으로 센다 (AC-136)
    if (!isRealQuestion(text) && s.turns.length > 1) return notUnderstood(s, ctx, ["상담사 연결", "괜찮아요"]);
    return out(pick(s, R, "unrelated"));
  }
  s.misunderstand = 0;
  if (sc.scope === "pending") { const o = handoff(s, ctx, "pending_policy"); o.say.unshift(pick(s, R, "pending_policy")); return o; }
  if (sc.scope === "related_out") {
    s.resume = s.state; s.state = "await_choice";
    const choices = s.channel === "voice" ? R.choices.out_of_rule_voice : R.choices.out_of_rule_text;
    return out(pick(s, R, "out_of_rule"), choices, [{ type: "candidate", text, reason: sc.reason }]);
  }
  const a = G.groundedAnswer(sc.rule, ctx.policy);
  const lines = [a.text, sourceLine(a.sources)];
  if (s.kind === "grade_out" && !s.offered_recheck && s.state === "free") {
    s.state = "offer_recheck"; s.offered_recheck = true;
    lines.push("그리고 3개월쯤 뒤에 상태를 한 번 더 확인해 드릴까요?");
    return out(lines, ["네", "아니요"]);
  }
  return out(lines);
}

function onChoice(s, text, ctx) {
  if (text.includes("직접")) { s.state = s.resume ?? "free"; return withReask(s, out("네, 같은 품목의 다른 제품이랑 예상 본인부담 금액을 화면에 띄워 드릴게요.", [], [{ type: "open_catalog" }])); }
  if (text.includes("괜찮") || G.isNo(text, ctx.rules)) { s.state = s.resume ?? "free"; return withReask(s, out("알겠어요. 나중에라도 궁금하시면 '상담사 연결'만 눌러 주세요.")); }
  return handoff(s, ctx, "out_of_rule");
}

// 예/아니요를 기다리던 중에 고객이 다른 질문을 하면, 답한 뒤 아까 질문을 다시 묻는다(시연 피드백 Q22).
const REASK = {
  ask_dx: ["혹시 병원에서 치매 진단을 받으신 적 있으세요?", ["네, 받았어요", "아직이요"]],
  offer_recheck: ["그리고 아까 여쭤본 것처럼, 3개월쯤 뒤에 상태를 한 번 더 확인해 드릴까요?", ["네", "아니요"]],
  offer_request: ["그럼 아까 말씀드린 용구 상담, 사업소에 요청해 드릴까요?", ["네", "아니요"]],
  readback: ["요청은 그대로 보내 드릴까요? 맞으면 '네, 보내 주세요'라고 말씀해 주세요.", ["네, 보내 주세요", "아니요"]],
  ask_next: ["6개월 뒤에도 이렇게 한 번 여쭤봐도 될까요?", ["네", "아니요"]],
  r1: ["예상 테스트를 한 번 더 해 보시겠어요?", ["네", "아니요"]],
  dx_choice: ["인정등급 상담사와 이야기해 보시겠어요?", ["인정등급 상담사 연결 (추천)", "괜찮아요"]],
  ask_dx_result: ["그리고 아까 여쭤본 것처럼, 검사 결과에서 치매 진단이 나오셨나요?", ["진단 받았어요", "진단은 아니래요", "결과 기다려요"]],
  ask_slot: ["그럼 아까 여쭤본 것처럼, 언제 연락드리면 편하세요?", Object.values(SLOTS).map((x) => x.label)],
};
function withReask(s, o) {
  const r = REASK[s.state];
  if (!r || s.state === "ended" || s.state === "await_choice") return o;
  o.say.push(r[0]); o.choices = r[1];
  return o;
}
/** 물음표가 붙어도 "네?" "아니요?" 같은 짧은 말은 질문으로 보지 않는다. */
const isRealQuestion = (text) => QUESTION.test(text) && text.replace(/[?\s.!]/g, "").length > 3;
/**
 * 답을 기다리는 동안(예/아니요 · 연락 시간 · 검사 결과) 들어온 '딴 질문'인지. 모든 대기 단계가 이 하나로 판단한다(Q29).
 * 진짜 질문 · 연락 시각 질문 · 돌봄과 관련 있는 4글자 넘는 말이면 먼저 답하고 아까 질문을 다시 묻는다.
 */
function isAside(text, ctx) {
  if (isRealQuestion(text) || isContactQuestion(text)) return true;
  return text.replace(/[?\s.!]/g, "").length > 3 && G.scope(text, ctx.rules, ctx.policy).scope !== "unrelated";
}

function onButtons(s, text, ctx) {
  if (text === "__no_response__") { s.state = "ended"; return out("답이 없으셔서, 상담사가 다시 연락드리도록 예약해 둘게요.", [], [{ type: "callback", reason: "misunderstand", when: "next_business_day" }]); }
  s.state = s.resume ?? "free"; s.misunderstand = 0;
  return route(s, text, ctx);
}

function notUnderstood(s, ctx, choices) {
  s.misunderstand += 1;
  if (s.misunderstand >= ctx.rules.handoff.misunderstand_limit) {
    s.resume = s.state; s.state = "await_buttons";
    return out(pick(s, ctx.rules, "buttons"), choices, [{ type: "buttons", choices }, { type: "alimtalk", text: "상담 선택 버튼", choices }]);
  }
  return out(pick(s, ctx.rules, "misunderstand"), choices);
}

function yesNo(s, text, ctx, onYes, onNo, choices = ["네", "아니요"]) {
  // 질문을 먼저 본다: "지원은 없어요?"의 '없어요'를 '아니요'로 잘못 읽지 않게
  // "보행기 값 좀 깎아 주세요"처럼 물음표 없는 요청도, 돌봄과 관련 있으면 새 질문으로 받는다
  if (isAside(text, ctx)) return withReask(s, free(s, text, ctx));
  if (G.isNo(text, ctx.rules)) { s.misunderstand = 0; return onNo(); }
  if (G.isYes(text, ctx.rules)) { s.misunderstand = 0; return onYes(); }
  return notUnderstood(s, ctx, choices);
}

function slotFrom(text) {
  if (text.includes("주말")) return "weekend_day";
  if (text.includes("저녁") || text.includes("퇴근")) return "weekday_evening";
  if (text.includes("낮") || text.includes("오전") || text.includes("평일")) return "weekday_day";
  return null;
}
const SLOT_CHOICES = Object.values(SLOTS).map((x) => x.label);

/** 점검 대답에 먼저 맞장구친다. 고객 말을 그대로 되풀이하지 않는다(개인정보 · 오인식 위험). */
function ack(s, text, R) {
  const c = R.classes;
  if (has(text, c.E)) return pick(s, R, "ack_E");
  if (has(text, c.B)) return pick(s, R, "ack_B");
  if (has(text, c.C)) return pick(s, R, "ack_C");
  if (has(text, c.A)) return pick(s, R, "ack_A");
  return pick(s, R, "ack_default");
}

// ── 연락 시각 질문 (Q29 · AC-148) ──
const isContactQuestion = (text) => /언제|몇 ?시|며칠/.test(text) && /연락|전화|와요|오나요|주나요|오는/.test(text);
function contactAnswer(s, ctx) {
  if (s.next_contact) {
    const d = new Date(s.next_contact);
    return [`3개월 뒤 연락은 ${d.getUTCFullYear()}년 ${fmtKo(d)}예요.`, "하루 전에 알림톡을 먼저 보내 드리고, 날짜는 알림톡에서 바꾸실 수 있어요."];
  }
  if (s.kind === "checkup_6m" || s.kind === "recheck_3m") return ["지금 이 전화가 약속드린 연락이에요. 다음 연락은 통화 끝에 함께 정해 드릴게요."];
  if (s.rejected.recheck) return ["아직 잡힌 연락은 없어요. 필요하시면 언제든 '상담사 연결'을 눌러 주세요."];
  return ["아직 잡힌 연락은 없어요. 원하시면 3개월 뒤에 상태를 확인하는 연락을 잡아 드릴게요."];
}

// ── 사람에게 넘긴 뒤 (Q27 · AC-138~141) ──
const WEEK = "일월화수목금토";
/** 가상 시계 규칙(UTC 칸 = 한국 시각)으로 '11월 20일(금) 오전 10시'. */
function fmtKo(d) {
  const h = d.getUTCHours();
  return `${d.getUTCMonth() + 1}월 ${d.getUTCDate()}일(${WEEK[d.getUTCDay()]}) ${h < 12 ? "오전" : "오후"} ${h % 12 || 12}시`;
}
function contactLine(s, ctx) {
  if (s.handoff_open) return "상담사가 곧 연결해 드릴게요.";
  const due = dueFor({ urgent: s.handoff === "emergency", kind: "콜백 예약", reason: s.handoff }, new Date(s.handoff_at), { rules: ctx.rules, holidays: ctx.holidays });
  return `괜찮으시면 상담사가 ${fmtKo(due)}까지 먼저 연락드릴게요.`;
}
function afterHandoff(s, text, ctx) {
  const R = ctx.rules;
  const note = { type: "task_note", text }; // 가명 처리된 말만 붙인다(AC-141)
  const question = isRealQuestion(text);
  // ① 위급으로 넘긴 상담: 질문이 아닌 말이면 안전부터 다시 확인 (AC-138)
  if (s.handoff === "emergency" && !question) {
    if (has(text, ["못 일어", "어려워", "어렵", "아파", "아프", "숨", "위험"]) && !has(text, ["괜찮"])) {
      return out([pick(s, R, "safety_urgent"), contactLine(s, ctx)], [], [note]);
    }
    if (has(text, ["괜찮", "일어나셨", "나아졌", "괜찮아"])) return out([pick(s, R, "safety_ok"), contactLine(s, ctx)], [], [note]);
    return out([pick(s, R, s.emergency === "넘어짐" ? "safety_check_fall" : "safety_check"), pick(s, R, "safety_119"), contactLine(s, ctx)],
      ["지금도 어려워요", "괜찮아요"], [note]);
  }
  // '언제 연락 와요?'는 작업 기한으로 답한다(기한의 정본은 tasks.js 규칙 + rules.json)
  if (isContactQuestion(text)) {
    return out(contactLine(s, ctx).replace("괜찮으시면 ", ""), [], [note]);
  }
  const sc = G.scope(text, R, ctx.policy);
  // ② 규정 안 질문은 평소처럼 근거로 답 (AC-140)
  if (sc.scope === "in") {
    const a = G.groundedAnswer(sc.rule, ctx.policy);
    return out([a.text, sourceLine(a.sources)], [], [note]);
  }
  // ③ 규정 밖 · 확인 중인 주제: 선택지 없이 상담사에게 같이 전함 (AC-139)
  if (sc.scope === "related_out" || sc.scope === "pending") return out(pick(s, R, "after_handoff_out"), [], [note, { type: "candidate", text, reason: sc.reason ?? "pending" }]);
  if (question) return out(pick(s, R, "unrelated"), [], [note]);
  return out(pick(s, R, "after_handoff_note"), [], [note]);
}

// ── 진단 있음 길 (AC-19) · 말 바꿈 (AC-134 · 135) ──
const DX_RESULT_CHOICES = ["진단 받았어요", "진단은 아니래요", "결과 기다려요"];
function dxYes(s, ctx, lead) {
  s.dx_answer = "yes"; s.state = "dx_choice";
  const a = G.groundedAnswer({ policy: "grade5", also: "cognitive" }, ctx.policy);
  return out([lead, a.text, sourceLine(a.sources),
    "진단이 있으시면 등급을 다시 받아 볼 만해요. 인정등급 상담사와 이야기해 보시겠어요?"],
  ["인정등급 상담사 연결 (추천)", "괜찮아요"]);
}
function onCorrection(s, text, ctx) {
  s.misunderstand = 0;
  if (text.includes("진단")) return dxYes(s, ctx, "아, 진단을 받으셨군요. 알려 주셔서 고마워요.");
  s.state = "ask_dx_result";
  return out(["아, 검사를 받으셨군요. 알려 주셔서 고마워요.", "결과에서 치매 진단이 나오셨나요?"], DX_RESULT_CHOICES);
}
/** 잡아 둔 3개월 연락은 그대로 둔다. 아직 없으면 다시 제안한다 (AC-135). */
function keepRecheck(s, ctx, lead) {
  s.dx_answer = "no_dx";
  if (s.scheduled) { s.state = "ended"; return out([lead, "잡아 둔 3개월 뒤 연락은 그대로 둘게요."]); }
  if (s.rejected.recheck) { s.state = "ended"; return out(lead); }
  s.state = "offer_recheck"; s.offered_recheck = true;
  return out([lead, "3개월쯤 뒤에 상태를 한 번 더 확인해 드릴까요?"], ["네", "아니요"]);
}

const STATES = {
  free(s, text, ctx) {
    if (G.behaviorSigns(text, ctx.rules)) {
      s.state = "ask_dx";
      const a = G.groundedAnswer({ policy: "dementia_center" }, ctx.policy);
      return out(["아이고, 걱정이 많으셨겠어요.", `이럴 땐 검사를 먼저 받아 보시는 게 좋아요. ${a.text}`, sourceLine(a.sources),
        "혹시 병원에서 치매 진단을 받으신 적 있으세요?"], ["네, 받았어요", "아직이요"]);
    }
    return free(s, text, ctx);
  },
  ask_dx(s, text, ctx) {
    return yesNo(s, text, ctx, () => dxYes(s, ctx, "그러셨군요. 그러면 꼭 알아 두실 게 있어요."), () => {
      s.dx_answer = "not_yet";
      s.state = "offer_recheck"; s.offered_recheck = true;
      return out(["네, 그러면 치매안심센터에서 검사부터 받아 보시길 권해요.", "그리고 3개월쯤 뒤에 상태를 한 번 더 확인해 드릴까요?"], ["네", "아니요"]);
    }, ["네, 받았어요", "아직이요"]);
  },
  // 말 바꿈 뒤 결과 질문 (AC-134 · 135)
  ask_dx_result(s, text, ctx) {
    if (!has(text, ["진단", "기다", "아니"]) && isAside(text, ctx)) return withReask(s, free(s, text, ctx));
    if (text.includes("기다")) return keepRecheck(s, ctx, "알겠어요. 결과가 나오면 언제든 '상담사 연결'을 눌러 주세요. 진단이 나오면 등급을 다시 받아 볼 수 있어요.");
    if (has(text, ["아니래", "아니에요", "아니었", "진단은 아니", "안 나왔"]) || (G.isNo(text, ctx.rules) && !text.includes("받았"))) {
      return keepRecheck(s, ctx, "다행이에요. 그래도 걱정되시면 언제든 '상담사 연결'을 눌러 주세요.");
    }
    // 진단이라고 분명히 말할 때만 진단 길로. '그래서 받으셨다니까요'처럼 애매하면 다시 묻는다
    if (!INSIST.test(text) && (text.includes("진단") || /^(네|예|응)([,.\s]|$)/.test(text.trim()))) return dxYes(s, ctx, "그러셨군요. 알려 주셔서 고마워요.");
    return notUnderstood(s, ctx, DX_RESULT_CHOICES);
  },
  dx_choice(s, text, ctx) {
    if (text.includes("연결") || G.isYes(text, ctx.rules)) return handoff(s, ctx, "diagnosed_grade_out");
    s.state = "offer_recheck"; s.offered_recheck = true;
    return out("알겠어요. 그러면 3개월쯤 뒤에 상태를 한 번 더 확인해 드릴까요?", ["네", "아니요"]);
  },
  offer_recheck(s, text, ctx) {
    return yesNo(s, text, ctx, () => {
      s.state = "ask_slot";
      return out("좋아요. 언제 연락드리면 편하세요?", SLOT_CHOICES);
    }, () => {
      s.rejected.recheck = true; s.state = "ended";
      return out("네, 알겠어요. 혹시 필요하시면 언제든 다시 찾아 주세요.");
    });
  },
  ask_slot(s, text, ctx) {
    const slot = slotFrom(text);
    if (!slot && isAside(text, ctx)) return withReask(s, free(s, text, ctx)); // 답한 뒤 시간을 다시 묻는다 (AC-149)
    if (!slot) return notUnderstood(s, ctx, SLOT_CHOICES);
    s.state = "ended"; s.scheduled = true;
    s.next_contact = computeDue(ctx.now, KIND_DAYS.recheck_3m, slot, ctx.holidays).toISOString(); // 앱과 같은 함수로 계산(AC-148)
    return out([`네, ${SLOTS[slot].label}에 연락드릴게요.`, "하루 전에 알림톡을 먼저 보내 드리고요, 날짜는 알림톡에서 바꾸실 수 있어요."], [],
      [{ type: "schedule", kind: "recheck_3m", slot, base_date: ctx.now.toISOString() }]);
  },

  // ── 6개월 점검: 질문 5개 (AC-41) ──
  q1: (s, t, c) => ask(s, t, c, "q2", ["혹시 불편하거나 고장 난 데는 없으세요?"]),
  q2: (s, t, c) => ask(s, t, c, "q3", ["어르신은 요즘 좀 어떠세요? 달라진 점 있으세요?"]),
  q3: (s, t, c) => {
    const won = Number(c.person?.remaining_limit ?? 0).toLocaleString("ko-KR");
    const src = c.policy.items.annual_limit;
    return ask(s, t, c, "q4", [`참, 올해 복지용구 한도는 ${won}원 남아 있어요. 더 필요한 용구가 있으세요?`,
      `${SOURCE}이로움 기록 · ${src.source} · ${src.as_of} 기준${src.verified ? "" : " · 확인 필요"}`]);
  },
  q4: (s, t, c) => ask(s, t, c, "q5", ["마지막으로, 더 도와드릴 일이 있을까요?"]),
  q5: (s, t, c) => { s.answers.push(t); return finishCheckup(s, c); },

  offer_request(s, text, ctx) {
    return yesNo(s, text, ctx, () => {
      s.state = "readback";
      return out(`그럼 '${s.request.what}' 요청을 담당 사업소에 보낼게요. 맞으면 '네, 보내 주세요'라고 말씀해 주세요.`, ["네, 보내 주세요", "아니요"]);
    }, () => { s.rejected.request = true; return askNext(s, "알겠어요, 그럼 요청은 안 할게요."); });
  },
  readback(s, text, ctx) {
    return yesNo(s, text, ctx, () => {
      const acts = [{ type: "request", what: s.request.what, item: ctx.order?.item },
        { type: "alimtalk", text: `요청 접수: ${s.request.what}`, cancel: true }];
      const o = askNext(s, "요청 보냈어요. 알림톡으로 내용이랑 취소 버튼도 보내 드렸어요.");
      o.actions.unshift(...acts);
      return o;
    }, () => { s.rejected.request = true; return askNext(s, "알겠어요, 요청은 보내지 않을게요."); }, ["네, 보내 주세요", "아니요"]);
  },
  ask_next(s, text, ctx) {
    return yesNo(s, text, ctx, () => { s.state = "ended"; return out("네, 그럼 6개월 뒤에 또 연락드릴게요. 시간 내 주셔서 고마워요.", [], [{ type: "checkup_done", class: s.class, continueNext: true }]); },
      () => { s.state = "ended"; return out("알겠어요, 다음 점검 연락은 드리지 않을게요. 시간 내 주셔서 고마워요.", [], [{ type: "checkup_done", class: s.class, continueNext: false }]); });
  },

  // ── 3개월 재검사 안내 ──
  r1(s, text, ctx) {
    return yesNo(s, text, ctx, () => { s.state = "r2"; return out(["링크 보내 드렸어요. 전화로 문항을 하나하나 여쭤보지는 않을게요.", "그동안 어르신은 좀 어떠셨어요?"], [], [{ type: "send_link", what: "retest" }]); },
      () => { s.state = "r2"; return out("알겠어요. 그동안 어르신은 좀 어떠셨어요?"); });
  },
  r2(s, text, ctx) { s.answers.push(text); s.state = "ended"; return out([ack(s, text, ctx.rules), "말씀 고마워요. 재검사 결과가 나오면 다음 안내를 드릴게요."]); },
};

function ask(s, text, ctx, nextState, question) {
  if (QUESTION.test(text) && G.scope(text, ctx.rules, ctx.policy).scope !== "in") {
    return free(s, text, ctx); // 질문이면 범위 판정. 선택 뒤에는 같은 질문(resume)으로 돌아온다
  }
  s.answers.push(text);
  s.state = nextState;
  return out([ack(s, text, ctx.rules), ...question]);
}

function askNext(s, lead) { s.state = "ask_next"; return out([lead, "6개월 뒤에도 이렇게 한 번 여쭤봐도 될까요?"], ["네", "아니요"]); }

function finishCheckup(s, ctx) {
  const cls = classify(s.answers, ctx.rules, { remainingLimit: ctx.person?.remaining_limit ?? 0 });
  s.class = cls;
  if (cls === "F") return handoff(s, ctx, "emergency", true);
  if (cls === "E") {
    const o = askNext(s, "불편을 드려서 정말 죄송해요. 상담사가 24시간 안에 직접 연락드릴게요.");
    o.actions.unshift({ type: "callback", reason: "complaint", within_hours: ctx.rules.handoff.complaint_callback_hours, summary: summary(s) });
    return o;
  }
  if (cls === "B") {
    s.problem = s.answers.find((a) => ctx.rules.classes.B.some((w) => a.includes(w))) ?? s.answers.join(" / ");
    const actions = [{ type: "as_ticket", item: ctx.order?.item, problem: s.problem }];
    const lines = ["아까 말씀하신 불편한 점은 A/S 접수를 해 둘게요. 수리 비용은 복지용구 가격에 이미 들어 있어서 따로 안 내셔도 돼요."];
    // 통화 중에 묻지 않는다. 전달 동의는 6개월 점검에 동의할 때 함께 받았다(Q19 · L-13).
    if (ctx.providerConsent) {
      lines.push("말씀하신 내용은 사업소에 그대로 전해 둘게요. 같은 이야기를 두 번 안 하셔도 돼요.");
      actions.push({ type: "provider_handoff", item: ctx.order?.item, problem: s.problem, contact_time: SLOTS.weekday_evening.label });
    } else {
      lines.push("사업소에서 연락드릴 수 있게, 원하시면 앱에서 '사업소에 전달'을 눌러 주세요.");
    }
    const o = askNext(s, lines.pop());
    o.say.unshift(...lines);
    o.actions.unshift(...actions);
    return o;
  }
  if (cls === "C") {
    if (ctx.isElder) {
      const o = askNext(s, "필요한 용구 상담은 보호자분께 한 번 확인한 뒤에 도와드릴게요. 보호자께 확인 알림을 보내 둘게요.");
      o.actions.unshift({ type: "guardian_confirm" }); return o;
    }
    s.request = { what: "지금 상태에 맞는 용구 상담" };
    s.state = "offer_request";
    return out("요즘 더 힘드시다고 하셨잖아요. 지금 상태에 맞는 용구 상담을 사업소에 요청해 드릴까요?", ["네", "아니요"]);
  }
  if (cls === "D") {
    const o = askNext(s, "남은 한도로 쓰실 수 있는 품목은 알림톡으로 정리해서 보내 드릴게요.");
    o.actions.unshift({ type: "alimtalk", text: "올해 남은 한도 안내" }); return o;
  }
  if (cls === "A") {
    const o = askNext(s, "잘 쓰고 계셔서 저도 기뻐요.");
    o.actions.unshift({ type: "alimtalk", text: "후기 요청" }); return o;
  }
  const o = askNext(s, "말씀 잘 들었어요. 담당자가 한 번 더 살펴볼게요.");
  o.actions.unshift({ type: "review_queue", summary: summary(s) }); return o;
}

/** 시험용: 한 문장을 하네스에 통과시켜 판정만 돌려준다(골든셋). */
export function evaluate(input, ctx, { context = "grade_out" } = {}) {
  const { masked } = mask(input, ctx.people ?? []);
  const R = ctx.rules;
  const res = { emergency: G.emergency(masked, R), human: G.wantsHuman(masked, R), injection: G.isInjection(masked, R),
    other_person: G.asksOtherPerson(masked, R), scope: null, class: null, masked };
  if (!res.emergency && !res.human && !res.injection && !res.other_person) res.scope = G.scope(masked, R, ctx.policy).scope;
  if (context === "checkup") res.class = classify([masked], R, { remainingLimit: ctx.remainingLimit ?? 0 });
  return res;
}
