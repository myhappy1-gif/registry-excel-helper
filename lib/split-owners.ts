// Design Ref: §2 — 소유자(소유기간)별로 같은 지번주소를 여러 줄로 나누고 줄 번호(소유자 순번)를 붙인다.
// Plan: PLAN.md 7번.

import { compareDates, parseDate } from "./dates";
import { normalizeValue } from "./normalize";
import type { RegistryOwner, RegistryReading, RowId } from "./types";

/** 지번주소의 공백을 한 칸으로 정리한다(보여주는 이름용). 같은 값 판단은 normalizeValue를 쓴다. */
export function tidyLot(lot: string): string {
  return lot.trim().replace(/\s+/g, " ");
}

export interface SplitOwner {
  rowId: RowId;
  owner: RegistryOwner;
  /** 어느 등기 그림에서 읽었는지 (출처 기록용) */
  sourceFile: string;
}

/**
 * 등기 한 장의 소유자들을 소유권이전일 순서대로 줄 하나씩으로 나눈다.
 * 날짜가 같거나 모르면 등기에 적힌 순서를 유지한다.
 */
export function splitOwners(reading: RegistryReading): SplitOwner[] {
  const lot = tidyLot(reading.lotAddress.value ?? "") || "(지번 불명)";
  const sorted = reading.owners
    .map((owner, order) => ({ owner, order, date: parseDate(owner.ownershipDate.value) }))
    .sort((a, b) => {
      if (a.date && b.date) {
        const c = compareDates(a.date, b.date);
        if (c !== 0) return c;
      } else if (a.date) return -1;
      else if (b.date) return 1;
      return a.order - b.order;
    });
  return sorted.map((s, i) => ({
    rowId: { lotAddress: lot, ownerIndex: i + 1 },
    owner: s.owner,
    sourceFile: reading.sourceFile,
  }));
}

/** 엑셀에서 읽은 줄들에 소유자 순번을 붙인다. 같은 지번(표기 차이 무시)이 나올 때마다 1, 2, 3… */
export function assignOwnerIndexes<T extends { lotAddress: string }>(rows: T[]): Array<T & { ownerIndex: number }> {
  const counts = new Map<string, number>();
  return rows.map((row) => {
    const key = normalizeValue("lotAddress", row.lotAddress);
    const next = (counts.get(key) ?? 0) + 1;
    counts.set(key, next);
    return { ...row, ownerIndex: next };
  });
}
