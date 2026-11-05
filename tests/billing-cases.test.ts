// 가짜 샘플 100건의 "부과 사례"별 결과 시험. 같은 지번의 소유자별로 계산한 부과 기간이 사례의 뜻과 맞는지 본다.
// 사례 이름표는 sample-data/fake-sample.json 의 cases(scripts/make-sample.mjs 가 만든다).
import { describe, expect, it } from "vitest";
import { calcBillingPeriod, type BillingResult } from "../lib/billing-period";
import { addDays, parseDate, skipWeekend, weekdayOf } from "../lib/dates";
import { runPipeline } from "../lib/pipeline";
import { loadSample } from "../lib/sample";
import type { ExcelRow } from "../lib/types";

const TODAY = "2026-11-05";
const sample = loadSample();
const result = runPipeline({ rows: sample.rows, city: sample.city, phones: sample.phones, sourceFiles: sample.sourceFiles, readRound: sample.readRound });
const norm = (s: string) => s.replace(/\s+/g, "");

/** 사례 이름표(앞 글자)별로 지번들의 소유자 줄과 부과 결과를 모은다. */
function lotsOf(prefix: string) {
  return sample.cases
    .filter((c) => c.tag.startsWith(prefix))
    .map((c) => {
      const rows: ExcelRow[] = result.rows.filter((r) => norm(r.rowId.lotAddress) === norm(c.lotAddress));
      const billing: BillingResult[] = rows.map((r) =>
        calcBillingPeriod({ ownershipDate: r.fields.ownershipDate, ownershipEndDate: r.fields.ownershipEndDate, lastBillingEndDate: r.fields.lastBillingEndDate, today: TODAY }),
      );
      return { tag: c.tag, rows, billing };
    });
}
/** 줄의 날짜 항목을 YYYY-MM-DD로 통일해 읽는다(엑셀 표기가 달라도 같은 값). */
const dateOf = (r: ExcelRow, f: "ownershipDate" | "ownershipEndDate" | "lastBillingEndDate"): string => parseDate(r.fields[f]) as string;
const targets = (b: BillingResult[]) => b.filter((x): x is Extract<BillingResult, { target: true }> => x.target);

describe("샘플 100건: 사례가 고르게 들어 있다", () => {
  it("등기 100장이고 30번째 이후 70개 지번에 사례 이름표가 붙어 있다", () => {
    expect(sample.sourceFiles).toHaveLength(100);
    expect(sample.cases).toHaveLength(70);
    expect(new Set(sample.cases.map((c) => c.tag.split(" ")[0])).size).toBeGreaterThanOrEqual(12); // A B C K D E1 E2 F1 F2 G1~G6 H1 H2 P
  });
});

describe("부과 사례별 결과", () => {
  it("A 구청 종료 이후 소유자 교체: 앞 소유자와 새 소유자 두 사람에게 기간을 나눠 부과한다", () => {
    const lots = lotsOf("A ");
    expect(lots).toHaveLength(12);
    for (const { rows, billing } of lots) {
      const [first, second] = targets(billing);
      expect(targets(billing)).toHaveLength(2);
      const last = dateOf(rows[0], "lastBillingEndDate");
      expect(first.start).toBe(skipWeekend(addDays(last, 1))); // 구청 마지막 부과 종료일 다음 날(주말이면 월요일)
      expect(first.end).toBe(addDays(dateOf(rows[0], "ownershipEndDate"), -1)); // 교체일 전날까지
      expect(second.start).toBe(dateOf(rows[1], "ownershipDate")); // 새 소유자는 소유권이전일부터
      expect(second.end).toBe(TODAY);
      expect(first.end < second.start).toBe(true); // 두 기간이 겹치지 않는다
    }
  });

  it("A 중 구청 마지막 부과일이 금·토요일이면 시작일이 다음 월요일로 밀린다", () => {
    const weekend = lotsOf("A ").filter(({ rows }) => [5, 6].includes(weekdayOf(dateOf(rows[0], "lastBillingEndDate"))));
    expect(weekend.length).toBeGreaterThanOrEqual(6);
    for (const { billing } of weekend) expect(weekdayOf(targets(billing)[0].start)).toBe(1); // 월요일
  });

  it("B 연쇄 교체(구청 종료가 첫 교체보다 앞): 세 사람 모두 부과 대상이고 기간이 이어진다", () => {
    for (const { billing } of lotsOf("B ")) {
      const t = targets(billing);
      expect(t).toHaveLength(3);
      expect(t[0].end < t[1].start && t[1].end < t[2].start).toBe(true);
    }
  });

  it("C 구청 종료가 교체 사이: 첫 소유자는 부과 대상이 아니고 나머지 두 사람에게 나눠 부과한다", () => {
    for (const { billing } of lotsOf("C ")) {
      expect(billing[0]).toEqual({ target: false, reason: "all-before-last-billing" });
      expect(targets(billing)).toHaveLength(2);
    }
  });

  it("K 구청 이력이 여러 건이어도 가장 늦은 종료일이 기준이다", () => {
    for (const { rows, billing } of lotsOf("K ")) {
      const last = dateOf(rows[0], "lastBillingEndDate");
      expect(billing[0]).toEqual({ target: false, reason: "all-before-last-billing" });
      expect(targets(billing)[0].start >= addDays(last, 1)).toBe(true);
    }
  });

  it("D 건물 소유기간은 긴데 부과는 구청 마지막 부과일 다음 날부터만 한다", () => {
    const lots = lotsOf("D ");
    expect(lots).toHaveLength(12);
    for (const { rows, billing } of lots) {
      const t = targets(billing);
      expect(t).toHaveLength(1);
      expect(dateOf(rows[0], "ownershipDate") < "2005-01-01").toBe(true); // 소유한 지는 오래됨
      expect(t[0].start).toBe(skipWeekend(addDays(dateOf(rows[0], "lastBillingEndDate"), 1)));
      expect(t[0].start > dateOf(rows[0], "ownershipDate")).toBe(true); // 부과는 용도폐지 이후만
    }
  });

  it("E 구청 이력이 없으면 소유권이전일부터 부과한다(소유자가 바뀌면 각자 소유기간만큼)", () => {
    for (const { rows, billing } of [...lotsOf("E1"), ...lotsOf("E2")]) {
      const t = targets(billing);
      expect(t).toHaveLength(rows.length);
      t.forEach((x, i) => expect(x.start).toBe(dateOf(rows[i], "ownershipDate")));
    }
  });

  it("F1 공유자는 각자 따로 같은 기간으로 계산한다", () => {
    for (const { billing } of lotsOf("F1")) {
      const t = targets(billing);
      expect(t.length).toBeGreaterThanOrEqual(2);
      expect(new Set(t.map((x) => `${x.start}~${x.end}`)).size).toBe(1);
    }
  });

  it("F2 공유자가 단독 소유자에게 이전: 구청 종료가 이전보다 앞이면 세 사람 모두, 뒤면 새 소유자만 부과한다", () => {
    const lots = lotsOf("F2");
    expect(lots).toHaveLength(4);
    lots.forEach(({ rows, billing }) => {
      const last = dateOf(rows[0], "lastBillingEndDate");
      const transfer = dateOf(rows[2], "ownershipDate");
      if (last < transfer) expect(targets(billing)).toHaveLength(3);
      else {
        expect(billing[0]).toEqual({ target: false, reason: "all-before-last-billing" });
        expect(targets(billing)).toHaveLength(1);
      }
    });
  });

  it("G 경계 사례: 소유권이전일/교체일이 구청 종료일과 맞닿는 날", () => {
    const g = (tag: string) => lotsOf(tag)[0];
    // G1: 소유권이전일 = 구청 종료일 다음 날 → 그날부터
    expect(targets(g("G1").billing)[0].start).toBe(dateOf(g("G1").rows[0], "ownershipDate"));
    // G2: 소유권이전일 = 구청 종료일 → 다음 날부터
    expect(targets(g("G2").billing)[0].start).toBe(addDays(dateOf(g("G2").rows[0], "ownershipDate"), 1));
    // G3·G4: 교체일이 구청 종료일(다음 날)과 맞닿으면 앞 소유자는 부과 대상이 아니고 새 소유자만 부과
    for (const tag of ["G3", "G4"]) {
      const { billing } = g(tag);
      expect(billing[0]).toEqual({ target: false, reason: "all-before-last-billing" });
      expect(targets(billing)).toHaveLength(1);
    }
    // G5: 소유권이전일이 토요일이고 이력이 없으면 그날부터(주말 이동은 구청 종료일 다음 날에만 적용)
    expect(weekdayOf(dateOf(g("G5").rows[0], "ownershipDate"))).toBe(6);
    expect(targets(g("G5").billing)[0].start).toBe(dateOf(g("G5").rows[0], "ownershipDate"));
    // G6: 금요일 종료 → 월요일 교체: 앞 소유자는 부과할 기간이 없다
    expect(g("G6").billing[0]).toEqual({ target: false, reason: "empty-period" });
    expect(targets(g("G6").billing)).toHaveLength(1);
  });

  it("H 구청이 이미 부과 종료일 이후까지 부과했으면 새로 부과할 기간이 없다", () => {
    for (const { billing } of lotsOf("H")) expect(billing[0]).toEqual({ target: false, reason: "billed-through-today" });
  });

  it("P 일반 단독 소유(이력 있음)는 모두 부과 대상이다", () => {
    for (const { billing } of lotsOf("P ")) expect(targets(billing)).toHaveLength(1);
  });
});
