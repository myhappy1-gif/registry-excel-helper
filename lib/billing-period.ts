// Design Ref: §2 부과 기간 계산 / PRD 6장 변상금 부과 기간 규칙.
// Plan: PLAN.md 6번. 순수 함수 — 오늘 날짜는 밖에서 받는다.
//
// 규칙
// - 부과 시작일 = 소유권이전일과 (구청 마지막 부과 종료일 + 1일) 중 늦은 날. 구청 이력이 없으면 소유권이전일.
//   구청 마지막 부과 종료일 다음 날이 토요일·일요일이면 다음 월요일로 옮긴다(2026-11-05 직원 결정).
// - 부과 종료일 = 소유종료일 하루 전과 "부과 종료일(일괄 입력)" 중 이른 날. 소유종료일이 비어 있으면 일괄 입력한 날.
//   (일괄 입력이 없으면 화면에서 오늘 날짜를 넣는다. 이 함수에서는 `today`라는 이름으로 받는다.)
// - 임시 가정(DESIGN.md 8장): 소유종료일은 "다음 사람에게 넘어간 날"이며 그날은 새 소유자 쪽에 넣는다.
//   그래서 앞 소유자의 부과 종료일은 소유종료일의 하루 전으로 해 하루가 겹치지 않게 한다.
// - 시작일이 종료일보다 늦으면 부과 대상이 아니다.

import { addDays, compareDates, maxDate, minDate, parseDate, skipWeekend } from "./dates";
import type { IsoDate } from "./types";

export interface BillingInput {
  ownershipDate: string | null;
  /** 현재 소유자는 비어 있음 */
  ownershipEndDate: string | null;
  /** 구청 마지막 부과 종료일 (이력이 없으면 비어 있음) */
  lastBillingEndDate: string | null;
  /** 부과 종료일로 쓸 날짜(일괄 입력한 날, 없으면 오늘). 이름은 예전 그대로 today. */
  today: IsoDate;
}

export type BillingSkipReason =
  | "no-ownership-date" // 소유권이전일을 몰라 계산할 수 없음
  | "invalid-date" // 날짜를 읽을 수 없음
  | "all-before-last-billing" // 소유기간 전체가 구청 부과 종료일 이전
  | "billed-through-today" // 구청이 이미 오늘까지(이후까지) 부과함
  | "empty-period";

export type BillingResult =
  | { target: true; start: IsoDate; end: IsoDate }
  | { target: false; reason: BillingSkipReason };

/** 쉬운 한국어 설명. */
export const BILLING_SKIP_TEXT: Record<BillingSkipReason, string> = {
  "no-ownership-date": "소유권이전일을 몰라서 계산할 수 없어요.",
  "invalid-date": "날짜를 읽을 수 없어서 계산할 수 없어요.",
  "all-before-last-billing": "소유한 기간이 모두 구청이 이미 부과한 기간 안이라 부과 대상이 아니에요.",
  "billed-through-today": "구청이 이미 부과 종료일까지 부과해서 새로 부과할 기간이 없어요.",
  "empty-period": "부과할 기간이 없어요.",
};

export function calcBillingPeriod(input: BillingInput): BillingResult {
  const hasText = (v: string | null) => v != null && v.trim() !== "";

  if (!hasText(input.ownershipDate)) return { target: false, reason: "no-ownership-date" };
  const own = parseDate(input.ownershipDate);
  if (!own) return { target: false, reason: "invalid-date" };

  const last = hasText(input.lastBillingEndDate) ? parseDate(input.lastBillingEndDate) : null;
  if (hasText(input.lastBillingEndDate) && !last) return { target: false, reason: "invalid-date" };

  const ownEnd = hasText(input.ownershipEndDate) ? parseDate(input.ownershipEndDate) : null;
  if (hasText(input.ownershipEndDate) && !ownEnd) return { target: false, reason: "invalid-date" };

  const start = last ? maxDate(own, skipWeekend(addDays(last, 1))) : own;
  const end = ownEnd ? minDate(addDays(ownEnd, -1), input.today) : input.today;

  if (compareDates(start, end) > 0) {
    if (last && ownEnd && compareDates(addDays(ownEnd, -1), last) <= 0) {
      return { target: false, reason: "all-before-last-billing" };
    }
    if (last && compareDates(last, input.today) >= 0) return { target: false, reason: "billed-through-today" };
    return { target: false, reason: "empty-period" };
  }
  return { target: true, start, end };
}
