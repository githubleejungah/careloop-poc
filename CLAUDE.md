# 돌봄 점검 루프 POC — 작업 규칙

이로움돌봄 개선 제안(포트폴리오 15~20쪽)의 "돌봄 점검 루프"를 무료로 시연하는 시제품.

## 먼저 읽을 문서
1. `docs/requirements.md` — 원문 · 인터뷰 · 가정 · 법적 확인 · 수용 기준(정본). 개수는 그 파일 6-2절에만 적는다
2. `docs/architecture.md` · `docs/data-model.md` · `docs/flows.md`
3. `docs/adr/`

## 확정된 결정
- **정적 사이트(HTML · CSS · JS) + 규칙 기반 상담원.** 서버 · LLM · 유료 API를 쓰지 않는다(AC-64, ADR-0001).
- 피클(개인용 AI 비서)은 쓰지 않는다. 회사 쪽 AI 상담원을 모의로 만든다(ADR-0002).
- 90 · 180일 재연락은 **가상 시계**로 시연한다(ADR-0003).
- 실제 개인정보 0건. 가상 이름 · 가상 번호만(AC-65). 회사 로고 · 실명은 쓰지 않는다.
- 하네스 규칙 · 제도 정보는 `site/data/*.json`이 정본이다. 코드에 숫자를 박지 않는다. 상담 시간 · 불만 연락 기한은 `rules.json`의 `handoff`에서만 읽는다(AC-131).
- **바꾸는 순서: 요구 문서(AC) → 사용자 승인 → 코드 → 시험.** 코드를 먼저 고치지 않는다(Q25).
- 바뀌는 개수(수용 기준 · 골든셋)는 문서에 되도록 쓰지 않는다. 쓴 곳은 `tests/drift.test.js`가 원본과 맞는지 본다(AC-132).
- 요구 사본(포트폴리오 04)은 손으로 복사하지 않는다. `node scripts/sync-copies.mjs`로 만든다. 사본 위치는 `copies.local.json`(Git 제외)에 둔다.
- 규칙을 바꾸면 골든셋 시험을 다시 돌린다. 위급 놓침 1건이면 고치기 전에는 커밋하지 않는다.
- 요구 · 구조 · 데이터 · 흐름이 바뀌면 같은 커밋에서 해당 문서를 고친다.
- `site/js/*.js`나 CSS를 고치면 `site/index.html`의 `?v=` 값을 **모두**(import map 안의 모듈 포함) 올린다(캐시 버스팅).
- 시연에서 이상한 대화가 나오면: 자동 시연 보고서에서 먼저 찾고, 진짜 문제면 `tests/dialog.test.js`에 고정한 뒤 요구 → 코드 순으로 고친다.
- 골든셋은 문장 판정만 본다. 대화 단계 문제는 `tests/harness.test.js`의 대화 흐름 시험으로 잡는다.

## 자주 쓰는 명령
```bash
python -m http.server 8010 --directory site
node --test tests/                     # 드리프트 점검 포함
node scripts/sync-copies.mjs           # 요구 사본 다시 만들기
npm run demo                           # 자동 시연 → reports/시연_날짜.md (의심 대화만)
python "C:/dev/workspace-igm/self study/ref-project/sdd/99_toolchain/01_automation/doc_lint.py" ears docs/requirements.md --min 100 --all-patterns --strict
```

## 사용자와 일하는 방식
- 한국어, 짧은 문장. 용어는 처음 나올 때 풀어 쓴다. 질문은 한 번에 하나, 추천과 이유를 붙인다.
- 커밋 · 푸시 · 공개 배포는 사용자가 정한다.
