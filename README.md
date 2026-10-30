# Bluffy Poker (WIP)

> **Work in progress.** AIPOT is being rebuilt as **Bluffy Poker** — free Texas Hold'em you play with friends right in the browser, peer-to-peer with no server and no signup. Bring your own AI key to invite LLM bots to the table.
>
> **개발 중입니다.** AIPOT을 서버·가입 없이 브라우저에서 친구들과 바로 하는 P2P 무료 포커 **Bluffy Poker**로 전환하고 있습니다. 아래는 기존 AIPOT(서버 버전) 설명입니다.

---

# AIPOT (기존 서버 버전)

AI BOT과 함께 텍사스 홀덤을 플레이하고, 경기 종료 후 액션 단위 복기까지 수행하는 AI 맞춤형 포커 트레이닝 서비스입니다.

## 서비스 한 줄 소개
AIPOT는 재미 중심의 플레이 경험과 실전 학습형 피드백 경험을 하나의 루프로 연결한 AI Poker Training Platform입니다.

## 기획 의도

- 서비스명: AIPOT (AI + Poker Table)
- 목적: 재미와 실전 연습을 동시에 제공하는 AI 맞춤형 텍사스 홀덤 트레이닝
- 타겟: 사람 대전이 부담스러운 초보/입문자, 플레이 복기로 실력을 올리고 싶은 유저

## 핵심 가치

1. 플레이 경험
- 공격형/밸런스형/타이트형 BOT을 조합해 연습 환경을 직접 구성

2. 학습 경험
- 핸드 로그를 기반으로 액션별 코칭, EV/Equity, GTO mix를 확인

3. 운영 안정성
- 멀티 LLM 프로바이더, 폴백 전략, 비동기 분석 잡 상태관리 적용

## 주요 기능

- 인증/권한
  - Guest / FREE / PRO
  - JWT 기반 로그인/게스트 세션

- 로비/룸
  - Quick Play, 공개/비공개 룸, 코드 입장
  - 좌석 착석/이탈/sit-out/sit-in
  - AI BOT 추가 및 모델/스타일 설정

- 실시간 게임
  - 상태 동기화, 액션 처리, 턴 타이머
  - BOT 턴 자동 판단 + 실패 시 폴백 의사결정
  - 스트리트 전환, 쇼다운, 승자 계산, 다음 핸드 진행

- 핸드 리뷰
  - 핸드 히스토리 조회/즐겨찾기
  - 전체 액션 비동기 분석(상태 폴링)
  - 액션별 분석 저장(EV/Equity/GTO mix 포함)

- 프로필/소셜/스토어
  - 아바타/언어 설정, 전적, 칩 구매, PRO 구독
  - 친구/친구요청/룸 초대

## 기술 스택

- Frontend
  - Vite, React, React Router, TypeScript

- Backend
  - NestJS, TypeORM, MySQL
  - Swagger(OpenAPI), JWT, class-validator

- AI
  - OpenAI / Claude / Gemini / Local LLM(OpenAI-compatible)

## 아키텍처 개요

- Frontend가 인증/로비/룸/게임/리뷰 API를 호출
- Backend의 StoreService가 게임 상태와 핸드 리뷰 저장을 관리
- AiService가 BOT 행동결정과 복기 분석을 프로바이더별로 실행
- state snapshot은 MySQL(state_snapshots) 테이블에 영속화

발표용 상세 다이어그램은 아래 문서를 참고하세요.

- 시스템 구조도: docs/plantuml/system-architecture.puml
- 클래스 다이어그램: docs/plantuml/class-diagram.puml
- 사용자 시나리오: docs/plantuml/user-scenario.puml
- AI 핵심 설계: docs/ai-core-design.md

## 실행 방법

### 1) Backend

```bash
cd backend
npm install
npm run start:dev
```

- Swagger: http://localhost:3000/swagger

### 2) Frontend

```bash
cd frontend
npm install
npm run dev
```

기본 API 주소는 http://localhost:3000 이며, 필요 시 frontend/.env에서 VITE_API_BASE_URL을 지정할 수 있습니다.

## 발표 데모 추천 시나리오

1. 로그인 후 로비에서 AI Bot Training Quick Play 진입
2. 플레이 중 BOT 스타일 차이(aggressive vs tight) 시연
3. 핸드 종료 후 Hand Review에서 비동기 분석 요청
4. Analyze Status polling -> 완료 후 액션별 코칭/EV/Equity 설명
5. Store에서 PRO 구독 후 고급 분석 접근 시연

## 프로젝트 구조

- backend: NestJS API, 게임 엔진, AI 연동, 상태 영속화
- frontend: 사용자 화면, 플레이 테이블, 복기 UI
- docs: 발표용 설계 문서 및 PlantUML 코드

## 향후 확장 방향

- Solver 연동 기반 정밀 코칭
- 개인화 학습 경로 추천
- 분석 품질 모니터링 및 모델 라우팅 최적화
