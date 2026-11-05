// Design Ref: §2 ⓒ 표기 정리 — 날짜는 항상 `YYYY-MM-DD`로 통일한다.
// 왜: `2020. 1. 2.`와 `2020-01-02`처럼 표기만 다른 날짜를 같은 값으로 보기 위해, 그리고 부과 기간 계산을 순수 함수로 두기 위해.

import type { IsoDate } from "./types";

function toIso(year: number, month: number, day: number): IsoDate | null {
  const time = Date.UTC(year, month - 1, day);
  const check = new Date(time);
  // 2월 30일 같은 없는 날짜를 걸러낸다.
  if (check.getUTCFullYear() !== year || check.getUTCMonth() !== month - 1 || check.getUTCDate() !== day) return null;
  return check.toISOString().slice(0, 10);
}

/** 여러 표기(2020-01-02, 2020. 1. 2., 2020년 1월 2일, 20200102)를 `YYYY-MM-DD`로 바꾼다. 읽을 수 없으면 null. */
export function parseDate(input: string | null | undefined): IsoDate | null {
  if (input == null) return null;
  const text = String(input).trim();
  if (!text) return null;
  const separated = text.match(/^(\d{4})\D+(\d{1,2})\D+(\d{1,2})\D*$/);
  if (separated) return toIso(Number(separated[1]), Number(separated[2]), Number(separated[3]));
  const compact = text.match(/^(\d{4})(\d{2})(\d{2})$/);
  if (compact) return toIso(Number(compact[1]), Number(compact[2]), Number(compact[3]));
  return null;
}

/** 날짜에 일수를 더한다(음수면 뺀다). */
export function addDays(date: IsoDate, days: number): IsoDate {
  const [y, m, d] = date.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}

/** 요일(0=일요일, 6=토요일). */
export function weekdayOf(date: IsoDate): number {
  const [y, m, d] = date.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

/** 토요일이면 다음 월요일, 일요일이면 다음 날(월요일)로 옮긴다. 평일이면 그대로. (공휴일은 따로 다루지 않는다) */
export function skipWeekend(date: IsoDate): IsoDate {
  const w = weekdayOf(date);
  return w === 6 ? addDays(date, 2) : w === 0 ? addDays(date, 1) : date;
}

/** 앞이 빠르면 -1, 같으면 0, 뒤가 빠르면 1. `YYYY-MM-DD`는 글자 순서가 곧 날짜 순서다. */
export function compareDates(a: IsoDate, b: IsoDate): -1 | 0 | 1 {
  return a < b ? -1 : a > b ? 1 : 0;
}

export const minDate = (a: IsoDate, b: IsoDate): IsoDate => (compareDates(a, b) <= 0 ? a : b);
export const maxDate = (a: IsoDate, b: IsoDate): IsoDate => (compareDates(a, b) >= 0 ? a : b);

/**
 * 한국 시간 기준 오늘 날짜.
 * 왜: 계산 함수가 오늘 날짜를 스스로 가져오면 시험 결과가 날마다 달라지므로, 오늘은 밖에서 받아 쓴다.
 */
export function todayKst(now: Date = new Date()): IsoDate {
  return new Date(now.getTime() + 9 * 60 * 60 * 1000).toISOString().slice(0, 10);
}
