// Design Ref: §2 ⓗ 모의 입력 큐 / PRD 5장 must 2.
// Plan: PLAN.md 17·18·19번. 승인한 줄만, 5개 항목만, 이미 입력한 줄은 건너뛰고, 연속 5건 실패하면 멈추고, 막힌 줄은 미처리 목록에 남긴다.
// 순수 함수라 화면 없이 시험할 수 있다. 실제 입력 동작(doInput)은 밖에서 넣어 준다(지금은 모의).

import { MAX_CONSECUTIVE_FAILURES } from "./constants";
import { ERROR_TEXT } from "./errors";
import { isBlank } from "./normalize";
import { formatRowId } from "./row-id";
import type { ApprovedInputJob, ExcelRow, InputField, InputJob, UnprocessedItem } from "./types";

/** 사내 프로그램에 입력하는 5개 항목 (이 밖의 항목은 입력하지 않는다). */
export const INPUT_FIELDS: readonly InputField[] = ["lotAddress", "name", "phone", "address", "rrn"];

/** 입력 항목의 쉬운 이름. */
export const INPUT_FIELD_LABEL: Record<InputField, string> = {
  lotAddress: "지번주소", name: "성명", phone: "전화번호", address: "주소", rrn: "주민등록번호",
};

export type InputValues = Record<InputField, string>;

/** 엑셀 줄에서 입력할 5개 항목만 뽑는다. 빈 항목이 있으면 missing에 담는다. */
export function buildInputValues(row: ExcelRow): { values: InputValues; missing: InputField[] } {
  const raw: Record<InputField, string | null> = {
    lotAddress: row.rowId.lotAddress, name: row.fields.name, phone: row.fields.phone,
    address: row.fields.address, rrn: row.fields.rrn,
  };
  const missing = INPUT_FIELDS.filter((f) => isBlank(raw[f]));
  const values = Object.fromEntries(INPUT_FIELDS.map((f) => [f, (raw[f] ?? "").trim()])) as InputValues;
  return { values, missing };
}

export type InputOutcome = { ok: true } | { ok: false; reason: string; field?: InputField };

/** 승인된 작업인지 확인하는 타입 검사. 이 검사를 통과한 작업만 입력 함수로 넘어간다. */
export const isApproved = (job: InputJob): job is ApprovedInputJob => job.approved === true;

export interface InputRunCounts {
  /** 이번에 새로 입력한 줄 */
  done: number;
  /** 이미 입력해서 다시 넣지 않은 줄 */
  skipped: number;
  failed: number;
  /** 직원이 제외했거나 승인하지 않은 줄 */
  excluded: number;
  /** 연속 실패로 멈춰서 시도하지 못한 줄 */
  notAttempted: number;
}

export interface InputRunResult {
  jobs: InputJob[];
  unprocessed: UnprocessedItem[];
  stoppedEarly: boolean;
  counts: InputRunCounts;
}

export interface RunInputOptions {
  doInput: (job: ApprovedInputJob) => InputOutcome;
  maxConsecutiveFailures?: number;
  /** 줄 하나를 처리할 때마다 불린다. 이어하기용 상태를 줄마다 저장하는 데 쓴다. */
  onProgress?: (jobs: readonly InputJob[]) => void;
}

export function runInput(jobs: InputJob[], options: RunInputOptions): InputRunResult {
  const limit = options.maxConsecutiveFailures ?? MAX_CONSECUTIVE_FAILURES;
  const out: InputJob[] = jobs.map((j) => ({ ...j }));
  const unprocessed: UnprocessedItem[] = [];
  const counts: InputRunCounts = { done: 0, skipped: 0, failed: 0, excluded: 0, notAttempted: 0 };
  let consecutive = 0;
  let stoppedEarly = false;

  for (const job of out) {
    if (!isApproved(job)) {
      // 승인하지 않은 줄은 절대 입력하지 않는다.
      job.status = "excluded";
      counts.excluded++;
      continue;
    }
    if (job.status === "done") {
      counts.skipped++; // 중복 입력 방지
      continue;
    }
    if (stoppedEarly) {
      counts.notAttempted++;
      unprocessed.push({ rowId: job.rowId, field: null, reason: ERROR_TEXT.consecutiveFailures });
      continue;
    }
    const outcome = options.doInput(job);
    if (outcome.ok) {
      job.status = "done";
      job.reason = null;
      counts.done++;
      consecutive = 0;
    } else {
      job.status = "failed";
      job.reason = outcome.reason;
      counts.failed++;
      consecutive++;
      unprocessed.push({ rowId: job.rowId, field: outcome.field ?? null, reason: outcome.reason });
      if (consecutive >= limit) stoppedEarly = true;
    }
    options.onProgress?.(out);
  }
  return { jobs: out, unprocessed, stoppedEarly, counts };
}

/** 입력이 끝난 뒤 건수 비교: 승인한 줄 수와 입력 완료 줄 수가 같은지. */
export function compareCounts(jobs: InputJob[]): { approved: number; done: number; matches: boolean } {
  const approved = jobs.filter(isApproved).length;
  const done = jobs.filter((j) => isApproved(j) && j.status === "done").length;
  return { approved, done, matches: approved === done };
}

export interface MockRecord {
  rowKey: string;
  values: InputValues;
}

/**
 * 모의 사내 프로그램. 실제로 입력하지 않고, 입력할 내용을 기록(record)만 한다.
 * failKeys에 든 줄은 일부러 실패시킨다(연속 5건 실패 시험용).
 */
export function makeMockInput(
  rowsByKey: ReadonlyMap<string, ExcelRow>,
  failKeys: ReadonlySet<string>,
  record: (rec: MockRecord) => void,
): (job: ApprovedInputJob) => InputOutcome {
  return (job) => {
    const key = formatRowId(job.rowId);
    if (failKeys.has(key)) return { ok: false, reason: "(시험용) 일부러 실패시킨 줄이에요." };
    const row = rowsByKey.get(key);
    if (!row) return { ok: false, reason: "엑셀에서 이 줄을 찾을 수 없어요." };
    const { values, missing } = buildInputValues(row);
    if (missing.length > 0) {
      return { ok: false, reason: `비어 있는 항목이 있어요: ${missing.map((f) => INPUT_FIELD_LABEL[f]).join(", ")}`, field: missing[0] };
    }
    record({ rowKey: key, values });
    return { ok: true };
  };
}
