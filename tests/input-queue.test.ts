import { describe, expect, it } from "vitest";
import { MAX_CONSECUTIVE_FAILURES } from "@/lib/constants";
import {
  INPUT_FIELDS, buildInputValues, compareCounts, isApproved, makeMockInput, runInput, type InputOutcome,
} from "@/lib/input-queue";
import { formatRowId } from "@/lib/row-id";
import type { InputJob } from "@/lib/types";
import { row } from "./helpers";

const job = (n: number, patch: Partial<InputJob> = {}): InputJob => ({
  rowId: { lotAddress: `테스트동 ${n}`, ownerIndex: 1 }, approved: true, status: "pending", reason: null, ...patch,
});
const ok: InputOutcome = { ok: true };
const fail = (reason = "실패"): InputOutcome => ({ ok: false, reason });

describe("모의 입력 큐", () => {
  it("승인한 줄만 입력하고, 승인 안 한 줄은 절대 입력하지 않는다", () => {
    const entered: string[] = [];
    const r = runInput([job(1), job(2, { approved: false })], {
      doInput: (j) => (entered.push(formatRowId(j.rowId)), ok),
    });
    expect(entered).toEqual(["테스트동 1 (1)"]);
    expect(r.counts).toMatchObject({ done: 1, excluded: 1 });
    expect(r.jobs[1].status).toBe("excluded");
  });

  it("이미 입력 끝난 줄은 다시 입력하지 않는다(중복 방지)", () => {
    let calls = 0;
    const r = runInput([job(1, { status: "done" }), job(2)], { doInput: () => (calls++, ok) });
    expect(calls).toBe(1);
    expect(r.counts).toMatchObject({ done: 1, skipped: 1 });
  });

  it("같은 지번의 두 번째 소유자를 이미 입력한 줄로 착각하지 않는다", () => {
    const a = { ...job(1), rowId: { lotAddress: "공유동 1", ownerIndex: 1 } };
    const b = { ...job(1), rowId: { lotAddress: "공유동 1", ownerIndex: 2 } };
    let calls = 0;
    runInput([{ ...a, status: "done" as const }, b], { doInput: () => (calls++, ok) });
    expect(calls).toBe(1);
  });

  it("연속 5건 실패하면 멈추고 남은 줄은 미처리 목록에 남긴다", () => {
    const jobs = Array.from({ length: 8 }, (_, i) => job(i + 1));
    let calls = 0;
    const r = runInput(jobs, { doInput: () => (calls++, fail("막힘")) });
    expect(MAX_CONSECUTIVE_FAILURES).toBe(5);
    expect(calls).toBe(5);
    expect(r.stoppedEarly).toBe(true);
    expect(r.counts).toMatchObject({ failed: 5, notAttempted: 3 });
    expect(r.unprocessed.length).toBe(8);
  });

  it("중간에 성공하면 연속 실패 횟수가 다시 시작된다", () => {
    const outcomes = [fail(), fail(), fail(), fail(), ok, fail(), fail(), fail(), fail()];
    let i = 0;
    const r = runInput(outcomes.map((_, n) => job(n + 1)), { doInput: () => outcomes[i++] });
    expect(r.stoppedEarly).toBe(false);
    expect(r.counts).toMatchObject({ done: 1, failed: 8 });
  });

  it("막힌 줄을 건너뛰고 끝까지 진행한 뒤, 위치와 사유를 남긴다", () => {
    const outcomes = [ok, fail("전화번호가 비었어요"), ok];
    let i = 0;
    const r = runInput([job(1), job(2), job(3)], { doInput: () => outcomes[i++] });
    expect(r.counts).toMatchObject({ done: 2, failed: 1 });
    expect(r.unprocessed).toEqual([{ rowId: job(2).rowId, field: null, reason: "전화번호가 비었어요" }]);
  });

  it("미처리 줄만 이어서 처리할 수 있다", () => {
    const first = runInput([job(1), job(2)], { doInput: (j) => (j.rowId.lotAddress.endsWith("1") ? ok : fail()) });
    const entered: string[] = [];
    const second = runInput(first.jobs, { doInput: (j) => (entered.push(j.rowId.lotAddress), ok) });
    expect(entered).toEqual(["테스트동 2"]); // 1번은 이미 완료라 다시 넣지 않음
    expect(compareCounts(second.jobs)).toEqual({ approved: 2, done: 2, matches: true });
  });

  it("끝나면 건수를 비교한다", () => {
    const r = runInput([job(1), job(2)], { doInput: (j) => (j.rowId.lotAddress.endsWith("1") ? ok : fail()) });
    expect(compareCounts(r.jobs)).toEqual({ approved: 2, done: 1, matches: false });
  });

  it("승인 표시 검사", () => {
    expect(isApproved(job(1))).toBe(true);
    expect(isApproved(job(1, { approved: false }))).toBe(false);
  });
});

describe("입력 항목", () => {
  it("지번주소·성명·전화번호·주소·주민등록번호 다섯 개뿐이다", () => {
    expect([...INPUT_FIELDS]).toEqual(["lotAddress", "name", "phone", "address", "rrn"]);
    const r = row("가동 1", 1, { name: "김", phone: "010-1111-2222", address: "주소", rrn: "800101-1234567", ownershipDate: "2020-01-01" });
    const { values, missing } = buildInputValues(r);
    expect(Object.keys(values).sort()).toEqual([...INPUT_FIELDS].sort());
    expect(missing).toEqual([]);
  });
  it("빈 항목이 있으면 모의 입력이 막히고 사유와 항목을 남긴다", () => {
    const r = row("가동 1", 1, { name: "김", phone: null, address: "주소", rrn: "800101-1234567" });
    const mock = makeMockInput(new Map([["가동 1 (1)", r]]), new Set(), () => {});
    const out = mock({ ...job(1), rowId: r.rowId, approved: true });
    expect(out).toMatchObject({ ok: false, field: "phone" });
  });
  it("일부러 실패시키는 줄 설정(시험용)", () => {
    const r = row("가동 1", 1, { name: "김", phone: "010-1111-2222", address: "주소", rrn: "800101-1234567" });
    const mock = makeMockInput(new Map([["가동 1 (1)", r]]), new Set(["가동 1 (1)"]), () => {});
    expect(mock({ ...job(1), rowId: r.rowId, approved: true }).ok).toBe(false);
  });
});
