// Design Ref: §2 ⓓ 짝짓기 규칙 — 등기 소유자와 엑셀 줄은 (정리한 지번주소 + 성명)으로 짝짓는다.
// 이름이 같거나 비어 있으면 주민등록번호 앞자리로 보조한다. 짝이 없으면 새 소유자 / 엑셀에만 있는 줄로 나눈다.
// Plan: PLAN.md 8번(짝짓기 부분).

import { isBlank, normalizeValue, rrnFront } from "./normalize";
import type { SplitOwner } from "./split-owners";
import type { ExcelRow } from "./types";

export interface MatchResult {
  /** 짝이 맞은 (등기 소유자, 엑셀 줄) */
  pairs: Array<{ split: SplitOwner; excel: ExcelRow }>;
  /** 등기에는 있는데 엑셀에 없는 새 소유자 */
  newOwners: SplitOwner[];
  /** 엑셀에만 있고 등기에서 짝을 못 찾은 줄 */
  orphans: ExcelRow[];
}

export function matchOwners(splits: SplitOwner[], rows: ExcelRow[]): MatchResult {
  const lots = new Map<string, { splits: SplitOwner[]; rows: ExcelRow[] }>();
  const bucket = (lot: string) => {
    const key = normalizeValue("lotAddress", lot);
    let b = lots.get(key);
    if (!b) lots.set(key, (b = { splits: [], rows: [] }));
    return b;
  };
  splits.forEach((s) => bucket(s.rowId.lotAddress).splits.push(s));
  rows.forEach((r) => bucket(r.rowId.lotAddress).rows.push(r));

  const result: MatchResult = { pairs: [], newOwners: [], orphans: [] };
  for (const { splits: lotSplits, rows: lotRows } of lots.values()) {
    const freeRows = new Set(lotRows);
    const left: SplitOwner[] = [];

    // 1차: 성명이 같은 줄
    for (const s of lotSplits) {
      const name = normalizeValue("name", s.owner.name.value);
      const hit = name ? lotRows.find((r) => freeRows.has(r) && normalizeValue("name", r.fields.name) === name) : undefined;
      if (hit) {
        freeRows.delete(hit);
        result.pairs.push({ split: s, excel: hit });
      } else left.push(s);
    }
    // 2차: 주민등록번호 앞자리가 같은 줄 (이름이 비었거나 읽기 어려운 경우)
    for (const s of left) {
      const front = rrnFront(s.owner.rrn.value);
      const hit = front
        ? lotRows.find((r) => freeRows.has(r) && !isBlank(r.fields.rrn) && rrnFront(r.fields.rrn) === front)
        : undefined;
      if (hit) {
        freeRows.delete(hit);
        result.pairs.push({ split: s, excel: hit });
      } else result.newOwners.push(s);
    }
    lotRows.forEach((r) => freeRows.has(r) && result.orphans.push(r));
  }
  return result;
}
