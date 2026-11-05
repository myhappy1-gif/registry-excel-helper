import { describe, expect, it } from "vitest";
import { applyDecisions, isResolved, itemKey, type Decision } from "@/lib/decisions";
import { matchOwners } from "@/lib/match-rows";
import { reconcile } from "@/lib/reconcile";
import { assignOwnerIndexes, splitOwners } from "@/lib/split-owners";
import type { ReconcileItem } from "@/lib/types";
import { owner, reading, row, rv } from "./helpers";

const LOT = "새솔동 27-1";
const find = (items: ReconcileItem[], field: string, idx = 1) => items.find((i) => i.field === field && i.rowId.ownerIndex === idx)!;

describe("소유자별 줄 나누기", () => {
  it("소유권이전일 순서대로 소유자 순번(줄 번호)을 붙인다", () => {
    const split = splitOwners(
      reading(LOT, [owner({ name: "나중", ownershipDate: rv("2020-01-01") }), owner({ name: "먼저", ownershipDate: rv("2010-01-01") })]),
    );
    expect(split.map((s) => [s.owner.name.value, s.rowId.ownerIndex])).toEqual([["먼저", 1], ["나중", 2]]);
  });
  it("엑셀 줄에는 같은 지번이 나올 때마다 순번을 붙인다", () => {
    const rows = assignOwnerIndexes([{ lotAddress: LOT }, { lotAddress: "한빛동 1" }, { lotAddress: "새솔동  27 - 1" }]);
    expect(rows.map((r) => r.ownerIndex)).toEqual([1, 1, 2]);
  });
});

describe("짝짓기", () => {
  it("지번과 성명이 같으면 짝을 맞춘다 (지번 표기 차이는 무시)", () => {
    const { pairs, newOwners, orphans } = matchOwners(
      splitOwners(reading(LOT, [owner({ name: "김가온" })])),
      [row("새솔동  27 - 1", 1, { name: "김 가온" })],
    );
    expect([pairs.length, newOwners.length, orphans.length]).toEqual([1, 0, 0]);
  });
  it("이름이 비어 있으면 주민번호 앞자리로 짝을 맞춘다", () => {
    const { pairs } = matchOwners(
      splitOwners(reading(LOT, [owner({ name: "김가온", rrn: rv("800101-1234567") })])),
      [row(LOT, 1, { name: null, rrn: "800101-9999999" })],
    );
    expect(pairs.length).toBe(1);
  });
  it("등기에만 있으면 새 소유자, 엑셀에만 있으면 엑셀에만 있는 줄", () => {
    const { newOwners, orphans } = matchOwners(
      splitOwners(reading(LOT, [owner({ name: "새사람", rrn: rv("900202-1111111") })])),
      [row(LOT, 1, { name: "옛사람", rrn: "700303-2222222" })],
    );
    expect([newOwners.length, orphans.length]).toEqual([1, 1]);
  });
});

describe("대조", () => {
  const run = (excelFields: Parameters<typeof row>[2], o = owner({ name: "김가온" }), city: Array<{ lotAddress: string; ownerName: string; startDate: string; endDate: string }> = []) =>
    reconcile({ rows: [row(LOT, 1, { name: "김가온", ...excelFields })], readings: [reading(LOT, [o])], city });

  it("엑셀 빈칸만 등기로 자동 보완한다", () => {
    const r = run({ rrn: null });
    expect(find(r.items, "rrn").status).toBe("filled");
    expect(r.rows[0].fields.rrn).toBe("800101-1234567");
  });
  it("값이 다르면 수정하지 않고 충돌로 보낸다", () => {
    const r = run({ rrn: "800101-9999999" });
    expect(find(r.items, "rrn").status).toBe("conflict");
    expect(r.rows[0].fields.rrn).toBe("800101-9999999"); // 엑셀 값 그대로
  });
  it("표기만 다르면 같은 값", () => {
    const r = run({ rrn: "8001011234567", ownershipDate: "2015. 3. 2." });
    expect(find(r.items, "rrn").status).toBe("same");
    expect(find(r.items, "ownershipDate").status).toBe("same");
  });
  it("읽은 글자 확신도가 90% 미만이면 자동 수정하지 않고 확인 필요", () => {
    const low = owner({ name: "김가온", address: rv("가상시 샘플구 연습로 1길 1", 89) });
    expect(find(run({ address: null }, low).items, "address").status).toBe("needs-check");
    expect(find(run({ address: "다른 주소" }, low).items, "address").status).toBe("needs-check");
    expect(run({ address: null }, low).rows[0].fields.address).toBeNull(); // 채우지 않음
  });
  it("확신도가 낮아도 엑셀 값과 같으면 문제 없다", () => {
    const low = owner({ name: "김가온", address: rv("가상시 샘플구 연습로 1길 1", 70) });
    expect(find(run({ address: "가상시 샘플구 연습로 1길 1" }, low).items, "address").status).toBe("same");
  });
  it("확신도가 정확히 90%면 믿는다", () => {
    const edge = owner({ name: "김가온", address: rv("가상시 샘플구 연습로 1길 1", 90) });
    expect(find(run({ address: null }, edge).items, "address").status).toBe("filled");
  });
  it("소유기간은 등기가 기준이라, 엑셀과 달라도 충돌로 묻지 않고 등기 값으로 고친다", () => {
    const o = owner({ name: "김가온", ownershipDate: rv("2015-03-02") });
    const r = run({ ownershipDate: "2014-03-02" }, o);
    const item = find(r.items, "ownershipDate");
    expect(item.status).toBe("filled");
    expect(item.registryWins).toBe(true);
    expect(item.excelValue).toBe("2014-03-02"); // 고치기 전 엑셀 값이 기록에 남는다
    expect(r.rows[0].fields.ownershipDate).toBe("2015-03-02");
  });
  it("현재 소유자인데 엑셀에 소유종료일이 있으면 등기 기준으로 비운다", () => {
    const r = run({ ownershipEndDate: "2020-01-01" });
    const item = find(r.items, "ownershipEndDate");
    expect(item.status).toBe("filled");
    expect(item.registryWins).toBe(true);
    expect(r.rows[0].fields.ownershipEndDate).toBeNull();
  });
  it("소유기간도 읽은 값이 불확실하면(확신도 90% 미만) 고치지 않고 확인 필요", () => {
    const low = owner({ name: "김가온", ownershipDate: rv("2015-03-02", 70) });
    const r = run({ ownershipDate: "2014-03-02" }, low);
    expect(find(r.items, "ownershipDate").status).toBe("needs-check");
    expect(r.rows[0].fields.ownershipDate).toBe("2014-03-02");
  });
  it("소유기간 밖의 항목(주소 등)은 여전히 충돌로 직원이 정한다", () => {
    const r = run({ address: "다른 주소" });
    expect(find(r.items, "address").status).toBe("conflict");
    expect(find(r.items, "address").registryWins).toBeUndefined();
  });
  it("엑셀에 없는 새 소유자는 줄을 추가하고 보완으로 표시한다", () => {
    const r = reconcile({
      rows: [row(LOT, 1, { name: "김가온", rrn: "800101-1234567" })],
      readings: [reading(LOT, [owner({ name: "김가온" }), owner({ name: "새사람", rrn: rv("900202-1111111"), ownershipDate: rv("2022-01-01") })])],
      city: [],
    });
    expect(r.rows.length).toBe(2);
    expect(r.newRowKeys).toEqual([`${LOT} (2)`]);
    const added = r.items.filter((i) => i.isNewRow && i.field === "name");
    expect(added[0].status).toBe("filled");
    expect(r.rows[1].fields.name).toBe("새사람");
  });
  it("엑셀에만 있는 줄은 확인 필요", () => {
    const r = reconcile({ rows: [row("없는동 1", 1, { name: "누군가" })], readings: [], city: [] });
    expect(r.orphanRowKeys).toEqual(["없는동 1 (1)"]);
    expect(r.items[0].status).toBe("needs-check");
  });
  it("구청 마지막 부과 종료일: 빈칸이면 같은 지번의 가장 늦은 종료일로 채운다", () => {
    const r = run({}, owner({ name: "김가온" }), [
      { lotAddress: LOT, ownerName: "A", startDate: "2015-01-01", endDate: "2021-06-30" },
      { lotAddress: "새솔동  27-1", ownerName: "B", startDate: "2021-07-01", endDate: "2023-12-31" },
    ]);
    expect(r.rows[0].fields.lastBillingEndDate).toBe("2023-12-31");
    expect(find(r.items, "lastBillingEndDate").source.kind).toBe("city-excel");
  });
  describe("가려진 주민등록번호 (등기 열람본은 뒷자리가 `*******`)", () => {
    const masked = owner({ name: "김가온", rrn: rv("800101-*******") });
    it("엑셀이 비어 있어도 가려진 번호로 채우지 않고 직접 입력을 요청한다", () => {
      const r = run({ rrn: null }, masked);
      expect(find(r.items, "rrn").status).toBe("needs-check");
      expect(r.rows[0].fields.rrn).toBeNull();
    });
    it("앞 6자리(생년월일)가 같으면 같은 값", () => {
      expect(find(run({ rrn: "800101-1234567" }, masked).items, "rrn").status).toBe("same");
    });
    it("앞 6자리가 다르면 충돌이고, '등기 값 쓰기'를 골라도 엑셀의 전체 번호를 지키지 않고 가려진 번호를 쓰지 않는다", () => {
      const r = run({ rrn: "900202-1234567" }, masked);
      const item = find(r.items, "rrn");
      expect(item.status).toBe("conflict");
      const applied = applyDecisions(r.rows, r.items, { [itemKey(item)]: { key: itemKey(item), choice: "registry" } });
      expect(applied.rows[0].fields.rrn).toBe("900202-1234567");
    });
  });
  describe("점유면적 (구청 엑셀 값을 옮기기만 한다)", () => {
    const cityOf = (area: string | null, name = "김가온") => [
      { lotAddress: LOT, ownerName: name, startDate: "2015-01-01", endDate: "2021-06-30", occupiedArea: area },
    ];
    it("엑셀 빈칸이면 구청 엑셀의 면적으로 채운다", () => {
      const r = run({}, owner({ name: "김가온" }), cityOf("45.3"));
      expect(r.rows[0].fields.occupiedArea).toBe("45.3");
      expect(find(r.items, "occupiedArea")).toMatchObject({ status: "filled", source: { kind: "city-excel" } });
    });
    it("표기만 다르면(45.30 / 45.3㎡) 같은 값", () => {
      const r = run({ occupiedArea: "45.30" }, owner({ name: "김가온" }), cityOf("45.3㎡"));
      expect(find(r.items, "occupiedArea").status).toBe("same");
    });
    it("값이 다르면 고치지 않고 충돌로 보낸다", () => {
      const r = run({ occupiedArea: "40" }, owner({ name: "김가온" }), cityOf("45.3"));
      expect(find(r.items, "occupiedArea").status).toBe("conflict");
      expect(r.rows[0].fields.occupiedArea).toBe("40");
    });
    it("이름이 다른 기록뿐이어도 그 지번의 면적이 하나뿐이면 쓴다(소유자 교체)", () => {
      const r = run({}, owner({ name: "김가온" }), cityOf("45.3", "이전소유자"));
      expect(r.rows[0].fields.occupiedArea).toBe("45.3");
    });
    it("같은 지번에 면적이 서로 다르고 이름도 안 맞으면 추측하지 않는다", () => {
      const city = [...cityOf("45.3", "A"), ...cityOf("60", "B")];
      const r = run({}, owner({ name: "김가온" }), city);
      expect(r.items.some((i) => i.field === "occupiedArea")).toBe(false);
    });
    it("구청 엑셀에 면적이 없으면 아무 것도 하지 않는다", () => {
      const r = run({ occupiedArea: "40" }, owner({ name: "김가온" }), cityOf(null));
      expect(r.items.some((i) => i.field === "occupiedArea")).toBe(false);
    });
  });
  it("모든 항목에 출처와 회차를 남긴다", () => {
    const r = run({ rrn: null });
    const item = find(r.items, "rrn");
    expect(item.source).toMatchObject({ kind: "registry", file: "fake-registry-01.png" });
    expect(item.round).toBe(1);
  });
});

describe("직원의 선택과 변경 기록", () => {
  const base = reconcile({
    rows: [row(LOT, 1, { name: "김가온", rrn: "800101-9999999", address: null })],
    readings: [reading(LOT, [owner({ name: "김가온" })])],
    city: [],
  });
  const conflict = find(base.items, "rrn");

  it("해결하지 않은 충돌은 남는다", () => {
    expect(isResolved(conflict, {})).toBe(false);
    expect(applyDecisions(base.rows, base.items, {}).unresolved.map((i) => i.field)).toContain("rrn");
  });
  it("등기 값을 고르면 반영하고 출처를 직원 선택으로 기록한다", () => {
    const decisions: Record<string, Decision> = { [itemKey(conflict)]: { key: itemKey(conflict), choice: "registry", at: "2026-11-04 10:00" } };
    const out = applyDecisions(base.rows, base.items, decisions);
    expect(out.rows[0].fields.rrn).toBe("800101-1234567");
    expect(out.log.some((l) => l.field === "rrn" && l.source.kind === "staff-choice")).toBe(true);
  });
  it("직접 입력도 반영하고, 빈 입력은 해결로 치지 않는다", () => {
    const k = itemKey(conflict);
    expect(isResolved(conflict, { [k]: { key: k, choice: "input", inputValue: "  " } })).toBe(false);
    const out = applyDecisions(base.rows, base.items, { [k]: { key: k, choice: "input", inputValue: "810202-2222222" } });
    expect(out.rows[0].fields.rrn).toBe("810202-2222222");
    expect(out.log.find((l) => l.field === "rrn")?.source.kind).toBe("staff-input");
  });
  it("자동 보완도 변경 기록에 남는다", () => {
    expect(applyDecisions(base.rows, base.items, {}).log.some((l) => l.field === "address" && l.source.kind === "registry")).toBe(true);
  });
});
