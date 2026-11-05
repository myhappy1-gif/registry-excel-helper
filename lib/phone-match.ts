// 전화번호 대조: 전화번호는 등기에 나오지 않으므로, 다른 엑셀(전화번호 엑셀)의 "이름-전화번호", "주소-전화번호" 기록과 맞춰 본다.
// 값을 바꾸지 않고 "어떤 근거로 어떤 번호가 나왔는지"만 판단하는 순수 함수라 시험하기 쉽다.
//
// 근거의 강도
// - exact   : 이름과 주소가 모두 같은 기록 → 같은 사람으로 보고 빈칸을 채워도 된다.
// - name    : 이름만 같은 기록(동명이인 가능) → 후보로만 보여 주고 직원이 확인한다.
// - address : 주소만 같은 기록(가족·세입자일 수 있음) → 후보로만 보여 주고 직원이 확인한다.
// - ambiguous: 같은 근거로 서로 다른 번호가 여러 개 → 직원이 직접 고른다.
// - none    : 찾지 못함.

import { isBlank, normalizeValue } from "./normalize";

export interface PhoneRecord {
  name: string;
  address: string;
  phone: string;
}

export type PhoneMatchKind = "exact" | "name" | "address" | "ambiguous" | "none";

export interface PhoneLookup {
  kind: PhoneMatchKind;
  /** 근거가 하나로 정해질 때의 전화번호(ambiguous·none이면 null) */
  phone: string | null;
  /** 서로 다른 후보 번호들(화면 표에만 보이고, 알림 문구에는 넣지 않는다) */
  candidates: string[];
}

const digits = (v: string) => normalizeValue("phone", v);

/** 서로 다른 번호만 남긴다(표기만 다른 같은 번호는 하나로). */
function distinctPhones(records: PhoneRecord[]): string[] {
  const seen = new Map<string, string>();
  for (const r of records) {
    const d = digits(r.phone);
    if (d && !seen.has(d)) seen.set(d, r.phone.trim());
  }
  return [...seen.values()];
}

function decide(kind: Exclude<PhoneMatchKind, "ambiguous" | "none">, records: PhoneRecord[]): PhoneLookup | null {
  const phones = distinctPhones(records);
  if (phones.length === 0) return null;
  return phones.length === 1 ? { kind, phone: phones[0], candidates: phones } : { kind: "ambiguous", phone: null, candidates: phones };
}

/** 이름·주소로 전화번호 엑셀에서 번호를 찾는다. 이름과 주소가 다 같을수록 확실한 근거로 본다. */
export function lookupPhone(name: string | null, address: string | null, records: PhoneRecord[]): PhoneLookup {
  const n = normalizeValue("name", name);
  const a = normalizeValue("address", address);
  const sameName = n ? records.filter((r) => normalizeValue("name", r.name) === n) : [];
  const sameAddr = a ? records.filter((r) => normalizeValue("address", r.address) === a) : [];

  const both = sameName.filter((r) => a !== "" && normalizeValue("address", r.address) === a);
  return (
    (both.length > 0 && decide("exact", both)) ||
    (sameName.length > 0 && decide("name", sameName)) ||
    (sameAddr.length > 0 && decide("address", sameAddr)) ||
    { kind: "none", phone: null, candidates: [] }
  );
}

export const PHONE_KIND_TEXT: Record<PhoneMatchKind, string> = {
  exact: "이름·주소 모두 같음",
  name: "이름만 같음",
  address: "주소만 같음",
  ambiguous: "같은 근거로 번호가 여러 개",
  none: "찾지 못함",
};

/** 전화번호 엑셀 한 줄이 쓸 수 있는 기록인지(이름이나 주소 중 하나와 번호가 있어야 한다). */
export const isUsablePhoneRecord = (r: PhoneRecord): boolean => !isBlank(r.phone) && (!isBlank(r.name) || !isBlank(r.address));
