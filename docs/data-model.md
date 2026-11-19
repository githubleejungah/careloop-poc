# 데이터 설계 — 돌봄 점검 루프 POC

작성 2026-11-19 · 상태: 승인(2026-11-19) · 구현 완료 · 모든 데이터는 가상이다(AC-65).

## 1. 정본 표

정본(가장 믿을 원본)은 하나만 둔다. 사본은 정본에서 만들어지고, 정본을 고치면 사본은 다시 만든다.

| 데이터 | 정본 | 주인(고치는 사람) | 사본 |
|---|---|---|---|
| 요구 · 수용 기준 | `docs/requirements.md` | 기획(사용자) | `지원양식/…/04_요구사항_돌봄점검루프.md`(포트폴리오 제출용 사본) |
| 하네스 규칙(위급 표현 · 범위 · 넘김 조건 · 선택지 문구) | `site/data/rules.json` | 기획 승인 | 실행 중 메모리 |
| 제도 정보(등급 기준 · 연 한도 · 본인부담률 · 출처 · 기준일) | `site/data/policy.json` | 기획 승인(제도 변경은 자동 점검 뒤 승인) | AI 답 문장 |
| 발음 사전(소리로 읽을 때만 바꾸는 단어) | `site/data/pronounce.json` | 기획 | 음성 읽기 |
| 공휴일 | `site/data/holidays.json` (한국천문연구원 월력요항 정리표, 2026 · 2027) | 개발 | — |
| 골든셋(시험 문항 · 정답) | `site/data/golden_set.json` | 기획 | `tests/` 시험 결과 |
| 예시 고시(제도 변경 점검용) | `site/data/policy_samples.json` | 개발(가상 예문) | 점검 보고서 |
| 가상 고객 · 어르신 · 주문 | `site/data/seed.json` | POC | `ecl:v1:people` · `ecl:v1:orders` |
| 상담 기록(가명) | `ecl:v1:sessions` | 시스템 | 상담사 화면 · 월간 보고 |
| 동의 | `ecl:v1:consents` | 고객(화면에서) | 일정 계산 |
| 재연락 일정 | `ecl:v1:schedules` | 시스템(`scheduler.js`) | 운영 화면 |
| 모의 발송함 | `ecl:v1:outbox` | 시스템(`channels.js`) | 운영 · 상담사 화면 |
| 상담 시간 · 불만 연락 기한 | `site/data/rules.json` → `handoff` (한 곳만, AC-131) | 기획 | `guard.js` · `tasks.js` · 안내 문장이 읽기만 함 |
| 상담사 작업 · 재확인 대기열 | `ecl:v1:tasks` | 시스템(`tasks.js` 규칙) → 상담사가 통화 결과를 적음 | 상담사 화면 · 경보 |
| 지표 · 경보 | `ecl:v1:metrics` · `ecl:v1:alerts` | 시스템(`log.js`) | 운영 화면 |
| 개선 후보 · 규정 후보 | `ecl:v1:candidates` | 시스템 → 사람 승인 | 승인 뒤 사람이 `site/data/rules.json`을 고침 |
| 가상 시계 | `ecl:v1:clock` | 운영 화면 | 모든 모듈 |
| 자동 시연 시나리오 · 끼워 넣을 말 | `scripts/demo/scenarios.json` | 기획 | 자동 시연 보고서 `reports/시연_날짜.md`(Git 제외, 가상 데이터만) |
| 요구 문서 | `docs/requirements.md` | 기획 | 포트폴리오 04 사본(`scripts/sync-copies.mjs`로만 만듦, 드리프트 점검 AC-132) |

- `ecl:v1:` 은 localStorage 키 접두사다(eroum care loop, 구조 판 1). 구조가 바뀌면 `v2`로 올린다.
- 실제 개인정보 원문은 어디에도 저장하지 않는다. 화면에 잠깐 보인 원문은 가명 처리 뒤 버린다(AC-89).

## 2. 구조

### 2-1. 하네스 규칙 `site/data/rules.json`
```json
{
  "version": "2026-11-19",
  "emergency": { "categories": ["넘어짐", "심한 통증", "숨쉬기 어려움", "학대", "극단적 표현"],
                 "phrases": { "넘어짐": ["넘어지", "낙상", "못 일어나"] } },
  "scope": {
    "in_rules": [{ "id": "R-grade-out", "topic": "등급외 뜻", "source": "policy.grade_rules" }],
    "related_keywords": ["보행기", "가격", "배송", "주문", "대여", "사업소", "등급"],
    "unrelated_reply": "그 부분은 제가 도와드리기 어려워요. 어머님 돌봄이나 이로움 서비스에서 궁금한 점이 있으세요?"
  },
  "handoff": { "misunderstand_limit": 2, "complaint_callback_hours": 24,
               "counsel_hours": { "weekdays": [1, 2, 3, 4, 5], "start": 10, "end": 16 } },
  "choices": { "text": ["상담사와 상의", "직접 보기", "괜찮아요"], "voice": ["상담사와 상의", "직접 보기"] },
  "pending_policy_topics": []
}
```

### 2-2. 제도 정보 `site/data/policy.json`
```json
{
  "items": [
    { "id": "grade5", "text": "치매환자 · 장기요양인정 점수 45점 이상 51점 미만 → 5등급",
      "source": "국민건강보험공단 등급판정 기준", "as_of": "2026-11-19" },
    { "id": "equip_price", "text": "복지용구 가격은 제품별 고시 가격, 배송 · 설치 · 수리 비용 포함",
      "source": "복지용구 급여범위 및 급여기준 등에 관한 고시 제6조", "as_of": "2026-11-19" }
  ]
}
```
- AI는 이 파일의 `text`만 말하고, `source` · `as_of`를 함께 말한다(AC-44, 83).

### 2-3. 상담 기록 `ecl:v1:sessions[]`
| 필드 | 뜻 | 예 |
|---|---|---|
| `id` | 상담 번호 | `S-0001` |
| `person_id` | 가상 보호자 번호 | `P-01` |
| `kind` | 상담 종류 | `grade_out` · `recheck_3m` · `checkup_6m` |
| `channel` | 방식 | `voice` · `text` · `human` |
| `turns[]` | 대화(가명 처리된 문장만) | `{ "who": "customer", "text": "[이름1] 님이 밤에 나가세요" }` |
| `class` | 분류 | `A`~`G` 또는 `null` |
| `handoff` | 넘김 이유 | `emergency` · `request` · `out_of_rule` · `misunderstand` · `complaint` · `diagnosed_grade_out` · `null` |
| `misunderstand_count` | 연속 못 알아들은 횟수 | `0`~`2` |
| `repeat_explain_count` | 넘긴 뒤 다시 설명한 횟수 | `0` |
| `latency_ms[]` | 대답 시간 | `[12, 8]` |
| `created_at` | 가상 시각 | `2026-11-19T19:05` |
| `raw_delete_at` | 원문 삭제 예정(30일 뒤, POC에서는 원문을 애초에 저장하지 않음) | `2026-12-19` |

### 2-4. 동의 `ecl:v1:consents[]`
| 필드 | 뜻 |
|---|---|
| `person_id` · `type` | `recheck_3m` · `checkup_6m` · `health_info` · `provider_share`(사업소 전달) |
| `granted_at` · `withdrawn_at` | 동의 · 철회 시각 |
| `preferred` | `{ "weekdays": [1,2,3,4,5], "slot": "19-21" }`, `"channel": "call"` · `"alimtalk"` |
| `cycle` | 몇 번째 주기인지(재동의 판단, AC-100 · 101) |

### 2-5. 재연락 일정 `ecl:v1:schedules[]`
| 필드 | 뜻 |
|---|---|
| `id` · `person_id` · `kind` | `recheck_3m` · `checkup_6m` |
| `base_date` | 결과일 또는 배송 · 설치 완료일 |
| `due_at` | 기준일(+90 · +180) → 요일 · 시간대 · 공휴일 · 야간 규칙을 적용한 실제 시각 |
| `state` | `scheduled` → `notified`(하루 전 알림) → `call1` → `call2` → `survey_sent` → `done` · `closed_G` · `cancelled` |
| `survey_deadline` | 설문 링크 보낸 날 + 7일(AC-103) |
| `no_answer_streak` | 연속 분류 G 주기 수(2면 멈춤, AC-104) |
| `stop_reason` | `withdrawn` · `returned` · `ended` · `admitted` · `left` · `no_answer_2` |

### 2-6. 모의 발송함 `ecl:v1:outbox[]`
| 필드 | 뜻 |
|---|---|
| `at` | 가상 발송 시각(밤 9시~아침 8시는 생기지 않음, AC-40) |
| `to` | `customer` · `provider`(사업소) · `counselor` · `manager` |
| `kind` | `call` · `alimtalk` · `provider_handoff` · `alert` |
| `payload` | 사업소 전달은 3가지만: `item` · `problem`(원문 1줄 + 요약, 가명) · `contact_time`(AC-48 · 49) |

### 2-7. 골든셋 `site/data/golden_set.json`
| 필드 | 뜻 |
|---|---|
| `id` | `GS-001`부터 차례로(50개 이상), 개인정보 빼내기 문항은 `GS-P01`~ |
| `input` | 고객 말(가상) |
| `expect` | `{ "scope": "related_out", "handoff": "out_of_rule", "class": null, "emergency": false, "leak": false }` |
| `tag` | `emergency` · `out_of_rule` · `unrelated` · `class_A`~`G` · `privacy` · `date` |

### 2-8. 제도 변경 점검 보고서(운영 화면, 저장 `ecl:v1:policy_reports[]`)
| 필드 | 뜻 |
|---|---|
| `notice_id` · `revised_at` | 고시 번호 · 개정일(중복 보고 막기, AC-108) |
| `promulgated` · `effective[]` | 공포일 · 조항별 시행일 |
| `grace_hits[]` | 발견된 유예 표현과 위치 |
| `quote_check` · `number_check` | 원문 인용 · 숫자 대조 결과 |
| `two_summary_diff` | 요약 2개가 다른지 |
| `level` | `green` · `yellow` · `red` |
| `status` | `pending` · `approved` · `rejected` · `escalated` |

### 2-9. 상담사 작업 `ecl:v1:tasks[]` (Q24 · AC-122~130)
| 필드 | 뜻 |
|---|---|
| `id` · `kind` | 작업 번호 · 종류(`콜백 예약` · `사람 연결` · `긴급 연결` · `24시간 안 연락` · `A/S 접수` 등) |
| `reason` · `urgent` | 넘긴 이유(`emergency` · `complaint` · `request` · `out_of_rule` …) · 위급 여부 |
| `person_id` · `session_id` | 가명 고객 · 상담 기록 연결(카드에서 가린 대화 전체를 펼쳐 봄) |
| `notices[]` | AI가 이미 한 안내(예: "119 안내함" · "다음 영업일 연락을 약속함"). 상담사가 같은 말을 다시 하지 않게 함 |
| `due_at` | 처리 기한(위급 · 시간 밖 → 다음 영업일 10:00, 불만 → 24시간, 그 밖 → 다음 영업일 16:00, AC-122) |
| `attempts` | 부재 횟수(위급 1번 → 상위 경보, 일반 2번 → 알림톡 후 닫음) |
| `reminded` · `escalated` | 1시간 전 알림 · 기한 넘김 경보를 이미 보냈는지(한 번씩만) |
| `status` | `open` · `done`. 통화 결과 없이 `done`이 되지 않음(AC-125) |
| `followups[]` | 넘긴 뒤 고객이 더 한 말(가명) `{ text, at }`. 카드에 '추가 질문'으로 보임(AC-141) |
| `history[]` | `{ result, at }`. result는 "연결됨" · "부재" · "다시 연락" 중 하나 |
