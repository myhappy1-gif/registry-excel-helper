// Design Ref: §1 ② 대조 결과 — 충돌·확인 필요 항목은 직원이 고르거나 직접 입력한다. 선택한 값은 수정본에 반영하고 출처는 "직원 선택/직원 입력"으로 기록한다.
// Plan: PLAN.md 10번(출처·근거 기록). 승인 화면에서 "해결 안 된 줄은 승인 불가"를 판단하는 데도 쓴다.

import { parseDate } from "./dates";
import { isBlank, isFrontOnlyRrn } from "./normalize";
import { formatRowId } from "./row-id";
import type { ExcelRow, FieldKey, ReconcileItem, RowId, Source } from "./types";

export type DecisionChoice = "excel" | "registry" | "input";

export interface Decision {
  /** itemKey(item) 값 */
  key: string;
  choice: DecisionChoice;
  /** choice가 "input"일 때 직원이 직접 넣은 값 */
  inputValue?: string;
  /** 선택한 시각 (기록용) */
  at?: string;
}

/** 대조 항목을 가리키는 이름: `줄 이름|항목` */
export const itemKey = (item: Pick<ReconcileItem, "rowId" | "field">): string => `${formatRowId(item.rowId)}|${item.field}`;

/** 직원이 정해야 하는 항목인지 (충돌·확인 필요). */
export const needsDecision = (item: ReconcileItem): boolean => item.status === "conflict" || item.status === "needs-check";

export function isResolved(item: ReconcileItem, decisions: Record<string, Decision>): boolean {
  if (!needsDecision(item)) return true;
  const d = decisions[itemKey(item)];
  if (!d) return false;
  return d.choice === "input" ? !isBlank(d.inputValue) : true;
}

/** 한 줄의 변경 기록: 무엇이 어떻게 바뀌었고 근거가 무엇인지. */
export interface ChangeLogEntry {
  rowId: RowId;
  field: FieldKey;
  from: string | null;
  to: string | null;
  source: Source;
  round?: number;
}

const DATE_FIELDS: ReadonlySet<FieldKey> = new Set(["ownershipDate", "ownershipEndDate", "lastBillingEndDate"]);
const stored = (field: FieldKey, v: string | null) => (v == null ? null : DATE_FIELDS.has(field) ? (parseDate(v) ?? v) : v);

export interface ApplyResult {
  /** 직원의 선택·입력을 반영한 엑셀 줄들 */
  rows: ExcelRow[];
  /** 아직 해결하지 못한 항목 */
  unresolved: ReconcileItem[];
  /** 자동 보완 + 직원 선택의 변경 기록 */
  log: ChangeLogEntry[];
}

export function applyDecisions(rows: ExcelRow[], items: ReconcileItem[], decisions: Record<string, Decision>): ApplyResult {
  const out: ExcelRow[] = rows.map((r) => ({ rowId: r.rowId, fields: { ...r.fields } }));
  const byKey = new Map(out.map((r) => [formatRowId(r.rowId), r]));
  const unresolved: ReconcileItem[] = [];
  const log: ChangeLogEntry[] = [];

  for (const item of items) {
    if (item.status === "filled") {
      log.push({ rowId: item.rowId, field: item.field, from: item.excelValue, to: stored(item.field, item.registryValue), source: item.source, round: item.round });
      continue;
    }
    if (!needsDecision(item)) continue;
    const d = decisions[itemKey(item)];
    if (!d || !isResolved(item, decisions)) {
      unresolved.push(item);
      continue;
    }
    const row = byKey.get(formatRowId(item.rowId));
    if (!row) continue;
    // "등기 값 쓰기"는 등기 값 그대로(등기가 비어 있으면 비움)를 반영한다.
    // 현재 소유자인데 엑셀에 소유종료일이 적힌 충돌처럼, 등기 기준으로 비우는 경우가 있기 때문이다.
    // (읽지 못해서 비어 있는 항목에는 화면에서 이 선택지를 보여주지 않는다.)
    // 가려진 주민등록번호(앞 6자리뿐)는 절대 엑셀에 쓰지 않는다. "등기 값 쓰기"를 눌러도 엑셀 값을 그대로 둔다.
    const maskedRrn = item.field === "rrn" && isFrontOnlyRrn(item.registryValue);
    const next =
      d.choice === "input" ? (d.inputValue ?? "").trim()
      : d.choice === "registry" && !maskedRrn ? item.registryValue
      : item.excelValue;
    const value = stored(item.field, next);
    if (value !== row.fields[item.field]) {
      log.push({
        rowId: item.rowId, field: item.field, from: row.fields[item.field], to: value, round: item.round,
        source: { kind: d.choice === "input" ? "staff-input" : "staff-choice", note: d.at ? `직원 ${d.choice === "input" ? "입력" : "선택"} (${d.at})` : undefined },
      });
      row.fields[item.field] = value;
    }
  }
  return { rows: out, unresolved, log };
}
