// 모의 발송함 · 작업함 (AC-35~39 · 47~50 · 53 · 106). 실제로 보내지 않는다.
import { clampQuiet } from "./scheduler.js";
import { makeTask } from "./tasks.js";

const PROVIDER_FIELDS = ["item", "problem", "contact_time"]; // 사업소에는 3가지만 (AC-48 · 49)

export function send(store, { at, to, kind, payload }) {
  const when = clampQuiet(new Date(at)).toISOString(); // 밤 9시~아침 8시 금지 (AC-40)
  return store.push("outbox", { at: when, to, kind, payload });
}

export function addTask(store, task) { return store.push("tasks", { status: "open", history: [], ...task }); }

/** 상담원이 돌려준 actions를 발송함 · 작업함 · 일정으로 옮긴다. scheduleFn은 app이 넘긴다. */
export function applyActions(store, actions, { now, person, session, scheduleFn, rules, holidays = [] }) {
  const at = now.toISOString();
  const cal = { rules, holidays }; // 상담 시간 · 불만 기한은 rules.json에서만 (AC-131)
  for (const a of actions) {
    switch (a.type) {
      case "handoff":
        // 상담 시간 밖이면 같은 상담의 callback 작업 하나로만 남긴다(작업 중복 방지)
        if (a.in_hours) addTask(store, makeTask({ kind: a.urgent ? "긴급 연결" : "사람 연결", reason: a.reason, urgent: !!a.urgent, person_id: person.id, session_id: session.id, summary: a.summary, notices: [...(session.notices ?? [])], at }, now, cal));
        break;
      case "callback":
        addTask(store, makeTask({ kind: a.reason === "complaint" ? "24시간 안 연락" : "콜백 예약", reason: a.reason, urgent: a.reason === "emergency",
          person_id: person.id, session_id: session.id, summary: a.summary ?? "", notices: [...(session.notices ?? [])], at }, now, cal));
        break;
      case "as_ticket":
        addTask(store, { kind: "A/S 접수", person_id: person.id, item: a.item, problem: a.problem, at });
        break;
      case "provider_handoff": {
        const payload = Object.fromEntries(PROVIDER_FIELDS.map((k) => [k, a[k]]));
        send(store, { at, to: "provider", kind: "사업소 전달", payload });
        break;
      }
      case "request":
        addTask(store, { kind: "요청 접수(되읽기 확인 완료)", person_id: person.id, what: a.what, item: a.item, at });
        break;
      case "alimtalk":
        send(store, { at, to: "customer", kind: "알림톡", payload: { text: a.text, cancel: !!a.cancel, choices: a.choices } });
        break;
      case "send_link":
        send(store, { at, to: "customer", kind: "알림톡", payload: { text: "예상 테스트 다시 하기 링크" } });
        break;
      case "review_queue":
        addTask(store, { kind: "분류 재확인", person_id: person.id, session_id: session.id, summary: a.summary, at });
        break;
      case "guardian_confirm":
        send(store, { at, to: "customer", kind: "알림톡(보호자 확인)", payload: { text: "어르신 요청 확인 부탁드려요" } });
        break;
      case "task_note": {
        // 넘긴 뒤 고객 말을 그 상담의 열린 작업 '추가 질문'에 붙인다 (AC-141). 열린 작업이 없으면 새 콜백 작업.
        const list = store.get("tasks", []);
        const t = [...list].reverse().find((x) => x.session_id === session.id && x.status === "open");
        if (t) { t.followups = [...(t.followups ?? []), { text: a.text, at }]; store.set("tasks", list); }
        else addTask(store, makeTask({ kind: "콜백 예약", reason: "followup", person_id: person.id, session_id: session.id, summary: a.text,
          followups: [{ text: a.text, at }], notices: [...(session.notices ?? [])], at }, now, cal));
        break;
      }
      case "candidate":
        store.push("candidates", { text: a.text, reason: a.reason, at });
        break;
      case "schedule":
      case "checkup_done":
        scheduleFn?.(a);
        break;
      default:
        break;
    }
  }
}
