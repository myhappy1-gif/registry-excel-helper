// 시험에서 쓰는 가짜 데이터 만들기 도구. (시험 파일이 아니라서 *.test.ts 이름이 아니다)
import type { ExcelRow, FieldKey, ReadValue, RegistryOwner, RegistryReading } from "@/lib/types";

export const rv = (value: string | null, confidence = 99): ReadValue => ({ value, confidence });

type OwnerParams = Partial<Omit<RegistryOwner, "name">> & { name: string };

export function owner(p: OwnerParams): RegistryOwner {
  return {
    name: rv(p.name),
    rrn: p.rrn ?? rv("800101-1234567"),
    address: p.address ?? rv("가상시 샘플구 연습로 1길 1"),
    ownershipDate: p.ownershipDate ?? rv("2015-03-02"),
    ownershipEndDate: p.ownershipEndDate ?? rv(null),
  };
}

export function reading(lot: string, owners: RegistryOwner[], sourceFile = "fake-registry-01.png"): RegistryReading {
  return { sourceFile, lotAddress: rv(lot), owners };
}

const BLANK: Record<FieldKey, string | null> = {
  name: null, phone: null, address: null, rrn: null, occupiedArea: null, ownershipDate: null, ownershipEndDate: null,
  lastBillingEndDate: null, billingStartDate: null, billingEndDate: null,
};

export function row(lot: string, ownerIndex: number, fields: Partial<Record<FieldKey, string | null>> = {}): ExcelRow {
  return { rowId: { lotAddress: lot, ownerIndex }, fields: { ...BLANK, ...fields } };
}
