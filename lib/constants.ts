// Design Ref: §3 폴더 구조 — 초기값(90%, 5건, 2~3회)을 한 곳에 모아 시범 운영 후 쉽게 조정한다.
// Plan: PLAN.md 1번. 값의 출처는 PRD.md 5장(주요 기능)이다.
// 다른 파일에서 숫자를 직접 쓰지 말고 반드시 여기서 가져다 쓴다.

/**
 * 글자 읽기 확신도 기준(%, 0~100).
 * 왜: 이 값 미만이면 자동 수정하지 않고 "확인 필요"로 보낸다.
 * 참고: Tesseract.js 점수 기준으로도 맞는지는 PLAN 22번 측정 때 다시 확인한다.
 */
export const CONFIDENCE_THRESHOLD = 90;

/**
 * 연속 입력 실패 한도(건).
 * 왜: 로그인 만료 같은 시스템 문제일 수 있으므로, 이만큼 연달아 실패하면 입력을 멈춘다.
 */
export const MAX_CONSECUTIVE_FAILURES = 5;

/** 반복 검증 기본 횟수(회). 2회째에 불일치가 남아 있으면 3회째까지 한다. */
export const MIN_VERIFY_ROUNDS = 2;

/** 반복 검증 최대 횟수(회). 3회 후에도 달라지는 항목은 "확인 필요"로 남긴다. */
export const MAX_VERIFY_ROUNDS = 3;

/** 위 값들을 한 묶음으로 보고 싶을 때 쓰는 객체. 값은 위 상수와 같다. */
export const SETTINGS = {
  confidenceThreshold: CONFIDENCE_THRESHOLD,
  maxConsecutiveFailures: MAX_CONSECUTIVE_FAILURES,
  minVerifyRounds: MIN_VERIFY_ROUNDS,
  maxVerifyRounds: MAX_VERIFY_ROUNDS,
} as const;
