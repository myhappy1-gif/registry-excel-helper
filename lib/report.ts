// Design Ref: §1 ④ 입력·리포트 / PRD 5장 nice 1 — 같음·보완·충돌·확인 필요·제외·입력 완료·미처리 건수만 담는다. 개인정보는 넣지 않는다.
// Plan: PLAN.md 20번.

import { formatRowId } from "./row-id";
import { INPUT_FIELD_LABEL, isApproved } from "./input-queue";
import type { InputJob, ReconcileItem, UnprocessedItem } from "./types";

export interface ReportSummary {
  counts: {
    same: number;
    filled: number;
    conflict: number;
    needsCheck: number;
    excluded: number;
    done: number;
    unprocessed: number;
  };
  /** 미처리 목록 (줄 이름·항목·사유만. 값은 담지 않는다) */
  unprocessed: Array<{ rowKey: string; field: string; reason: string }>;
}

export function buildReportSummary(items: ReconcileItem[], jobs: InputJob[], unprocessed: UnprocessedItem[]): ReportSummary {
  const countOf = (status: ReconcileItem["status"]) => items.filter((i) => i.status === status).length;
  return {
    counts: {
      same: countOf("same"),
      filled: countOf("filled"),
      conflict: countOf("conflict"),
      needsCheck: countOf("needs-check"),
      excluded: jobs.filter((j) => !isApproved(j)).length,
      done: jobs.filter((j) => isApproved(j) && j.status === "done").length,
      unprocessed: unprocessed.length,
    },
    unprocessed: unprocessed.map((u) => ({
      rowKey: formatRowId(u.rowId),
      field: u.field ? INPUT_FIELD_LABEL[u.field] : "줄 전체",
      reason: u.reason,
    })),
  };
}

/** 리포트 표에 쓰는 항목 이름 (순서 고정). */
export const REPORT_LABELS: Array<[keyof ReportSummary["counts"], string]> = [
  ["same", "같음"],
  ["filled", "보완"],
  ["conflict", "충돌"],
  ["needsCheck", "확인 필요"],
  ["excluded", "제외"],
  ["done", "입력 완료"],
  ["unprocessed", "미처리"],
];
