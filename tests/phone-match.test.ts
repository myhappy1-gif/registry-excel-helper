import { describe, expect, it } from "vitest";
import { lookupPhone, type PhoneRecord } from "../lib/phone-match";
import { runPipeline } from "../lib/pipeline";
import { reconcile } from "../lib/reconcile";
import { loadSample } from "../lib/sample";
import type { ExcelRow, RegistryReading } from "../lib/types";

const rec = (name: string, address: string, phone: string): PhoneRecord => ({ name, address, phone });
const RECORDS = [
  rec("김가온", "가상시 샘플구 연습로 1길 1", "010-1111-2222"),
  rec("김가온", "가상시 샘플구 연습로 9길 9", "010-3333-4444"), // 동명이인
  rec("박나래", "가상시 샘플구 연습로 2길 2", "01055556666"),
  rec("이다솜", "가상시 샘플구 연습로 2길 2", "010-7777-8888"), // 박나래와 같은 주소(가족)
];

describe("전화번호 찾기(lookupPhone)", () => {
  it("이름·주소가 모두 같으면 확실한 근거(exact)", () => {
    expect(lookupPhone("김가온", "가상시 샘플구 연습로 1길 1", RECORDS)).toMatchObject({ kind: "exact", phone: "010-1111-2222" });
  });
  it("공백·하이픈 같은 표기 차이는 같은 값으로 본다", () => {
    expect(lookupPhone("김 가온", "가상시 샘플구 연습로 1길-1", RECORDS).kind).toBe("exact");
  });
  it("이름만 같고 번호가 하나면 후보(name), 번호가 여러 개면 모호(ambiguous)", () => {
    expect(lookupPhone("박나래", "다른 주소", RECORDS)).toMatchObject({ kind: "name", phone: "01055556666" });
    expect(lookupPhone("김가온", "다른 주소", RECORDS)).toMatchObject({ kind: "ambiguous", phone: null });
  });
  it("주소만 같고 이름이 다르면 후보(address)이고, 같은 주소에 번호가 여러 개면 모호", () => {
    expect(lookupPhone("최모름", "가상시 샘플구 연습로 1길 1", RECORDS)).toMatchObject({ kind: "address", phone: "010-1111-2222" });
    expect(lookupPhone("최모름", "가상시 샘플구 연습로 2길 2", RECORDS).kind).toBe("ambiguous");
  });
  it("아무것도 안 맞으면 찾지 못함", () => {
    expect(lookupPhone("없는사람", "없는 주소", RECORDS)).toMatchObject({ kind: "none", phone: null });
  });
});

const LOT = "하늘동 4";
const row = (phone: string | null): ExcelRow => ({
  rowId: { lotAddress: LOT, ownerIndex: 1 },
  fields: { name: "김가온", phone, address: "가상시 샘플구 연습로 1길 1", rrn: null, occupiedArea: null, ownershipDate: null, ownershipEndDate: null, lastBillingEndDate: null, billingStartDate: null, billingEndDate: null },
});
const reading = (): RegistryReading => ({
  sourceFile: "x.pdf",
  lotAddress: { value: LOT, confidence: 100 },
  owners: [{
    name: { value: "김가온", confidence: 100 }, rrn: { value: null, confidence: 100 }, address: { value: "가상시 샘플구 연습로 1길 1", confidence: 100 },
    ownershipDate: { value: null, confidence: 100 }, ownershipEndDate: { value: null, confidence: 100 },
  }],
});
const phoneItem = (phone: string | null, phones: PhoneRecord[]) => {
  const r = reconcile({ rows: [row(phone)], readings: [reading()], city: [], phones });
  return { r, item: r.items.find((i) => i.field === "phone") };
};

describe("전화번호 대조(reconcile)", () => {
  it("빈칸 + 이름·주소가 모두 같은 기록 → 자동 보완", () => {
    const { r, item } = phoneItem(null, RECORDS);
    expect(item?.status).toBe("filled");
    expect(item?.source.kind).toBe("phone-excel");
    expect(r.rows[0].fields.phone).toBe("010-1111-2222");
  });
  it("빈칸 + 이름만 같은 기록 → 자동으로 채우지 않고 후보로 직원 확인", () => {
    const { r, item } = phoneItem(null, [rec("김가온", "다른 주소", "010-9999-0000")]);
    expect(item?.status).toBe("needs-check");
    expect(item?.registryValue).toBe("010-9999-0000");
    expect(r.rows[0].fields.phone).toBeNull();
    expect(r.phoneMatches[0].result).toBe("candidate");
  });
  it("빈칸 + 못 찾음 → 직접 입력 요청", () => {
    const { item, r } = phoneItem(null, []);
    expect(item?.status).toBe("needs-check");
    expect(r.phoneMatches[0].result).toBe("not-found");
  });
  it("번호가 있고 표기만 다르면 같음", () => {
    expect(phoneItem("01011112222", RECORDS).item?.status).toBe("same");
  });
  it("번호가 다르고 이름·주소가 모두 같으면 충돌(엑셀 값은 그대로)", () => {
    const { item, r } = phoneItem("010-0000-0000", RECORDS);
    expect(item?.status).toBe("conflict");
    expect(r.rows[0].fields.phone).toBe("010-0000-0000");
  });
  it("번호가 다르지만 이름만 같은 기록이면 충돌로 묻지 않고 참고만", () => {
    const { item, r } = phoneItem("010-0000-0000", [rec("김가온", "다른 주소", "010-9999-0000")]);
    expect(item).toBeUndefined();
    expect(r.phoneMatches[0].result).toBe("kept");
  });
  it("전화번호 엑셀이 없으면 전화번호 대조를 하지 않는다(새 줄이 아니면 항목 없음)", () => {
    const r = reconcile({ rows: [row(null)], readings: [reading()], city: [] });
    expect(r.items.find((i) => i.field === "phone")).toBeUndefined();
    expect(r.phoneMatches).toEqual([]);
  });
});

describe("가짜 샘플 100건 전화번호 대조", () => {
  it("전화번호 엑셀을 쓰면 보완·충돌·후보가 나온다", () => {
    const s = loadSample();
    expect(s.phones.length).toBeGreaterThan(20);
    const res = runPipeline({ rows: s.rows, city: s.city, phones: s.phones, sourceFiles: s.sourceFiles, readRound: s.readRound });
    const by = (k: string) => res.phoneMatches.filter((p) => p.result === k).length;
    console.log(`[전화번호] 같음 ${by("same")} / 보완 ${by("filled")} / 충돌 ${by("conflict")} / 후보 ${by("candidate")} / 못 찾음 ${by("not-found")} / 참고만 ${by("kept")} (전체 ${res.phoneMatches.length}줄)`);
    expect(by("same")).toBeGreaterThan(0);
    expect(by("conflict")).toBeGreaterThan(0);
    expect(by("filled") + by("candidate")).toBeGreaterThan(0);
  });
});

describe("전화번호 엑셀 읽기·대조표 만들기", () => {
  it("가짜 전화번호 엑셀을 읽고, 대조표 엑셀을 만든다", async () => {
    const { readPhoneRecords, buildPhoneWorkbook } = await import("../lib/excel-io");
    const records = await readPhoneRecords("sample-data/fake-phone.xlsx");
    expect(records.length).toBeGreaterThan(20);
    expect(records[0]).toMatchObject({ name: expect.any(String), phone: expect.any(String) });
    const buf = await buildPhoneWorkbook([{ rowKey: "하늘동 4 (1)", name: "김가온", address: "주소", excelPhone: null, foundPhone: "010-1111-2222", finalPhone: "010-1111-2222", kind: "exact", result: "빈칸 보완" }]);
    expect(buf.length).toBeGreaterThan(1000);
  });
});
