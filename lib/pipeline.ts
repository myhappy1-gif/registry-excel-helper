// Design Ref: §2 데이터 흐름 — 등기 읽기(회차 반복) → 표기 정리·짝짓기 → 대조를 한 번에 돌린다.
// 화면·파일과 무관한 순수 함수. 읽는 방법(샘플/내 컴퓨터)은 readRound로 밖에서 넣어 준다.

import { calcBillingPeriod, type BillingResult } from "./billing-period";
import type { PhoneRecord } from "./phone-match";
import { reconcile, type PhoneMatchInfo } from "./reconcile";
import { formatRowId } from "./row-id";
import { verifyReading } from "./verify-loop";
import type {
  BillingHistory, ExcelRow, IsoDate, ReadMethod, ReconcileItem, ReconcileStatus, RegistryReading,
} from "./types";

export interface PipelineInput {
  rows: ExcelRow[];
  city: BillingHistory[];
  sourceFiles: string[];
  /** 전화번호 엑셀의 기록들(없으면 전화번호 대조를 하지 않는다) */
  phones?: PhoneRecord[];
  readRound: (sourceFile: string, round: number, method: ReadMethod) => RegistryReading;
}

export interface VerifySummary {
  sourceFile: string;
  rounds: number;
  unstableCount: number;
}

export interface PipelineResult {
  items: ReconcileItem[];
  rows: ExcelRow[];
  newRowKeys: string[];
  orphanRowKeys: string[];
  /** 전화번호 엑셀과 대조한 결과(전화번호 엑셀이 없으면 빈 목록) */
  phoneMatches: PhoneMatchInfo[];
  verify: VerifySummary[];
  stats: {
    registries: number;
    rows: number;
    maxRounds: number;
    counts: Record<ReconcileStatus, number>;
  };
}

export function runPipeline(input: PipelineInput): PipelineResult {
  const readings: RegistryReading[] = [];
  const roundsBySource: Record<string, number> = {};
  const verify: VerifySummary[] = [];

  for (const file of input.sourceFiles) {
    const outcome = verifyReading((round, method) => input.readRound(file, round, method));
    readings.push({ ...outcome.finalReading, sourceFile: file });
    roundsBySource[file] = outcome.rounds;
    verify.push({ sourceFile: file, rounds: outcome.rounds, unstableCount: outcome.unstablePaths.length });
  }

  const result = reconcile({ rows: input.rows, readings, city: input.city, phones: input.phones, roundsBySource });
  const counts: Record<ReconcileStatus, number> = { same: 0, filled: 0, conflict: 0, "needs-check": 0 };
  result.items.forEach((i) => counts[i.status]++);

  return {
    ...result,
    verify,
    stats: {
      registries: readings.length,
      rows: result.rows.length,
      maxRounds: Math.max(0, ...verify.map((v) => v.rounds)),
      counts,
    },
  };
}

/**
 * 줄마다 부과 시작일·종료일을 계산해 줄에 채워 넣는다(수정본 엑셀과 사내 프로그램 입력에 쓰는 최종 줄).
 * 부과 대상이 아니면 두 칸을 비운다. endDate는 직원이 일괄 입력한 부과 종료일(없으면 오늘).
 */
export function applyBilling(rows: ExcelRow[], endDate: IsoDate): ExcelRow[] {
  const billing = computeBilling(rows, endDate);
  return rows.map((r) => {
    const b = billing[formatRowId(r.rowId)];
    return { rowId: r.rowId, fields: { ...r.fields, billingStartDate: b?.target ? b.start : null, billingEndDate: b?.target ? b.end : null } };
  });
}

/** 줄마다 부과 기간을 계산한다. 부과 종료일(일괄 입력, 없으면 오늘)은 밖에서 받는다. */
export function computeBilling(rows: ExcelRow[], today: IsoDate): Record<string, BillingResult> {
  const out: Record<string, BillingResult> = {};
  for (const row of rows) {
    out[formatRowId(row.rowId)] = calcBillingPeriod({
      ownershipDate: row.fields.ownershipDate,
      ownershipEndDate: row.fields.ownershipEndDate,
      lastBillingEndDate: row.fields.lastBillingEndDate,
      today,
    });
  }
  return out;
}
