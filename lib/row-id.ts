// Design Ref: §0 용어 표 — 줄 번호는 지번주소 + 소유자 순번이며, 화면·기록에는 `XX동 27-1 (1)` 처럼 쓴다.

import type { RowId } from "./types";

/** 화면과 기록에 쓰는 줄 이름. 예: `새솔동 27-1 (2)` */
export function formatRowId(id: RowId): string {
  return `${id.lotAddress} (${id.ownerIndex})`;
}

/** 같은 줄인지 (지번주소는 글자 그대로 비교한다. 표기 차이는 정리한 뒤에 넘겨야 한다). */
export function sameRowId(a: RowId, b: RowId): boolean {
  return a.lotAddress === b.lotAddress && a.ownerIndex === b.ownerIndex;
}
