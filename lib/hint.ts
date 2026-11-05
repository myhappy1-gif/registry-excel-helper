// 충돌 항목을 직원이 빨리 판단하도록 돕는 짧은 힌트. 값을 바꾸지 않고 설명만 돌려준다 (결정은 항상 직원이 한다).
// 업무 규칙이라 화면과 분리해 시험할 수 있게 순수 함수로 둔다.

import { parseDate } from "./dates";
import { isBlank } from "./normalize";
import type { FieldKey } from "./types";

/** 두 글자 묶음이 몇 글자 다른지(글자 바꾸기·넣기·빼기 횟수). 최대 한도를 넘으면 한도+1을 돌려준다. */
function editDistance(a: string, b: string, limit: number): number {
  if (Math.abs(a.length - b.length) > limit) return limit + 1;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    for (let j = 1; j <= b.length; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    prev = cur;
  }
  return prev[b.length];
}

/** 충돌 항목에 붙일 힌트. 알려 줄 만한 특징이 없으면 null. */
export function conflictHint(field: FieldKey, excelValue: string | null, otherValue: string | null): string | null {
  if (isBlank(excelValue) || isBlank(otherValue)) return null;

  const a = parseDate(excelValue as string);
  const b = parseDate(otherValue as string);
  if (a && b) {
    if (a.slice(5) === b.slice(5)) return `월·일은 같고 연도만 달라요. (${a.slice(0, 4)}년 ↔ ${b.slice(0, 4)}년)`;
    if (a.slice(0, 4) === b.slice(0, 4)) return "연도는 같고 월·일이 달라요.";
    return null;
  }

  const x = (excelValue as string).replace(/[\s,-]/g, "");
  const y = (otherValue as string).replace(/[\s,-]/g, "");
  if (x.length >= 4 && editDistance(x, y, 1) <= 1) return "딱 한 글자만 달라요. 입력 실수일 가능성이 높아요.";
  return null;
}
