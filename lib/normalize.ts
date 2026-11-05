// Design Ref: §2 ⓒ 표기 정리 — 공백·쉼표·하이픈·띄어쓰기·날짜 표기 차이는 같은 값으로 본다 (PRD 5장 must 1).
// Plan: PLAN.md 5번.

import { parseDate } from "./dates";
import type { FieldKey } from "./types";

/** 같은 값 판단을 할 수 있는 항목: 엑셀 9개 항목 + 지번주소. */
export type NormalizableField = FieldKey | "lotAddress";

const DATE_FIELDS: ReadonlySet<NormalizableField> = new Set([
  "ownershipDate", "ownershipEndDate", "lastBillingEndDate", "billingStartDate", "billingEndDate",
]);

/**
 * 비교용으로 값을 한 가지 모양으로 정리한다. 화면에 보여주는 값이 아니라 "같은지 보는" 용도다.
 * 참고: 주소의 하이픈을 지우므로 `27-1`과 `271`도 같게 보인다. 규칙(하이픈 차이는 같은 값)을 그대로 따른 결과다.
 */
export function normalizeValue(field: NormalizableField, value: string | null | undefined): string {
  if (value == null) return "";
  const raw = String(value).trim();
  if (DATE_FIELDS.has(field)) return parseDate(raw) ?? raw.replace(/\s+/g, "");
  switch (field) {
    case "rrn":
    case "phone":
      return raw.replace(/\D/g, "");
    case "name":
      return raw.replace(/\s+/g, "");
    case "occupiedArea": {
      // 면적은 숫자로 본다: "45.30", "45.3㎡", "1,045.3 ㎡"는 같은 값. 숫자로 읽을 수 없으면 글자만 정리한다.
      const cleaned = raw.replace(/[,\s]/g, "").replace(/(㎡|m2|㎡)$/i, "");
      return /^\d+(\.\d+)?$/.test(cleaned) ? String(Number(cleaned)) : cleaned;
    }
    default:
      // address, lotAddress
      return raw.replace(/[\s,\-‐‑–—]/g, "");
  }
}

/** 값이 비어 있는지(공백뿐인 것 포함). */
export function isBlank(value: string | null | undefined): boolean {
  return value == null || String(value).trim() === "";
}

/** 두 값이 표기 차이만 있고 같은지. 둘 다 비어 있으면 같다고 본다. */
export function isSameValue(field: NormalizableField, a: string | null | undefined, b: string | null | undefined): boolean {
  return normalizeValue(field, a) === normalizeValue(field, b);
}

/**
 * 주민등록번호가 앞 6자리만 있는지. 인터넷등기소 열람본은 뒷자리를 `*******`로 가려서 보여 주기 때문에,
 * 등기에서 읽은 번호는 앞 6자리만 비교할 수 있고 전체 번호로 엑셀을 채울 수는 없다.
 */
export function isFrontOnlyRrn(value: string | null | undefined): boolean {
  return normalizeValue("rrn", value).length === 6;
}

/** 주민등록번호 앞 6자리(생년월일). 짝짓기를 도울 때만 쓰고, 화면·로그에는 내보내지 않는다. */
export function rrnFront(value: string | null | undefined): string {
  const digits = normalizeValue("rrn", value);
  return digits.length >= 6 ? digits.slice(0, 6) : "";
}
