import { describe, expect, it } from "vitest";
import { calcBillingPeriod } from "@/lib/billing-period";

const today = "2026-11-04"; // 오늘은 밖에서 넣는다 → 시험 결과가 날마다 바뀌지 않는다

describe("부과 기간 계산", () => {
  it("구청 부과 이력이 없으면 소유권이전일부터 오늘까지", () => {
    expect(calcBillingPeriod({ ownershipDate: "2024-01-01", ownershipEndDate: null, lastBillingEndDate: null, today }))
      .toEqual({ target: true, start: "2024-01-01", end: today });
  });

  it("구청 마지막 부과 종료일 다음 날부터 오늘까지", () => {
    expect(calcBillingPeriod({ ownershipDate: "2020-01-01", ownershipEndDate: null, lastBillingEndDate: "2025-12-31", today }))
      .toEqual({ target: true, start: "2026-01-01", end: today });
  });

  it("소유권이전일이 구청 종료일 다음 날보다 늦으면 소유권이전일부터", () => {
    expect(calcBillingPeriod({ ownershipDate: "2026-03-01", ownershipEndDate: null, lastBillingEndDate: "2025-12-31", today }))
      .toEqual({ target: true, start: "2026-03-01", end: today });
  });

  it("소유자가 바뀌면 각자 소유한 기간만큼, 바뀌는 날은 겹치지 않는다", () => {
    const a = calcBillingPeriod({ ownershipDate: "2020-01-01", ownershipEndDate: "2023-06-10", lastBillingEndDate: "2021-12-31", today });
    const b = calcBillingPeriod({ ownershipDate: "2023-06-10", ownershipEndDate: null, lastBillingEndDate: "2021-12-31", today });
    expect(a).toEqual({ target: true, start: "2022-01-03", end: "2023-06-09" }); // 2022-01-01은 토요일 → 월요일로
    expect(b).toEqual({ target: true, start: "2023-06-10", end: today });
    // 앞 사람의 종료일이 뒷사람의 시작일보다 빨라야 한다
    if (a.target && b.target) expect(a.end < b.start).toBe(true);
  });

  it("공유자는 각자 따로 계산해도 같은 입력이면 같은 결과", () => {
    const input = { ownershipDate: "2018-05-05", ownershipEndDate: null, lastBillingEndDate: "2022-01-31", today };
    expect(calcBillingPeriod(input)).toEqual(calcBillingPeriod({ ...input }));
  });

  it("소유기간 전체가 구청 부과 종료일 이전이면 부과 대상이 아니다", () => {
    expect(calcBillingPeriod({ ownershipDate: "2018-01-01", ownershipEndDate: "2020-01-01", lastBillingEndDate: "2021-12-31", today }))
      .toEqual({ target: false, reason: "all-before-last-billing" });
  });

  it("구청이 이미 오늘까지 부과했으면 새로 부과할 기간이 없다", () => {
    expect(calcBillingPeriod({ ownershipDate: "2020-01-01", ownershipEndDate: null, lastBillingEndDate: today, today }))
      .toEqual({ target: false, reason: "billed-through-today" });
  });

  it("날짜가 없거나 읽을 수 없으면 계산하지 않는다", () => {
    expect(calcBillingPeriod({ ownershipDate: null, ownershipEndDate: null, lastBillingEndDate: null, today }))
      .toEqual({ target: false, reason: "no-ownership-date" });
    expect(calcBillingPeriod({ ownershipDate: "글자", ownershipEndDate: null, lastBillingEndDate: null, today }))
      .toEqual({ target: false, reason: "invalid-date" });
  });

  it("날짜 표기가 달라도 같은 결과", () => {
    expect(calcBillingPeriod({ ownershipDate: "2024. 1. 1.", ownershipEndDate: null, lastBillingEndDate: "2025. 12. 31.", today }))
      .toEqual({ target: true, start: "2026-01-01", end: today });
  });
});

describe("부과 시작일: 구청 마지막 부과 종료일 다음 날이 주말이면 다음 월요일", () => {
  const base = { ownershipDate: "2020-01-01", ownershipEndDate: null, today };
  it("다음 날이 토요일이면 월요일로 (2026-10-02 금 → 다음 날 토 → 10-05 월)", () => {
    expect(calcBillingPeriod({ ...base, lastBillingEndDate: "2026-10-02" })).toEqual({ target: true, start: "2026-10-05", end: today });
  });
  it("다음 날이 일요일이면 월요일로 (2026-10-03 토 → 다음 날 일 → 10-05 월)", () => {
    expect(calcBillingPeriod({ ...base, lastBillingEndDate: "2026-10-03" })).toEqual({ target: true, start: "2026-10-05", end: today });
  });
  it("다음 날이 평일이면 그대로 (2026-10-05 월 → 10-06 화)", () => {
    expect(calcBillingPeriod({ ...base, lastBillingEndDate: "2026-10-05" })).toEqual({ target: true, start: "2026-10-06", end: today });
  });
  it("부과 종료일(일괄 입력)을 앞당기면 그 날까지만 부과한다", () => {
    expect(calcBillingPeriod({ ...base, lastBillingEndDate: "2026-10-02", today: "2026-12-31" })).toEqual({ target: true, start: "2026-10-05", end: "2026-12-31" });
  });
});
