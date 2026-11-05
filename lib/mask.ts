// Design Ref: §2 안전 장치 — 로그·콘솔·리포트에는 개인정보를 그대로 내보내지 않고 이 함수들을 거친다 (CLAUDE.md 5장).
// 화면에는 샘플(가짜) 데이터라 원래 값을 보여주지만, 나중에 실제 데이터를 쓸 때를 대비해 출력은 항상 여기를 거친다.

import type { ExcelRow, FieldKey, ReconcileItem } from "./types";

export function maskName(name: string | null): string {
  if (!name) return "";
  const chars = [...name.replace(/\s+/g, "")];
  return chars.length <= 1 ? "○" : chars[0] + "○".repeat(chars.length - 1);
}

export function maskPhone(phone: string | null): string {
  if (!phone) return "";
  const digits = phone.replace(/\D/g, "");
  if (digits.length >= 10) return `${digits.slice(0, 3)}-****-${digits.slice(-4)}`;
  return digits.length > 4 ? `****${digits.slice(-4)}` : "****";
}

export function maskRrn(rrn: string | null): string {
  if (!rrn) return "";
  const digits = rrn.replace(/\D/g, "");
  return digits.length >= 6 ? `${digits.slice(0, 6)}-*******` : "******-*******";
}

export function maskAddress(address: string | null): string {
  if (!address) return "";
  const first = address.trim().split(/\s+/)[0];
  return `${first} ***`;
}

/** 항목 종류에 맞게 가린다. 날짜 같은 개인정보가 아닌 항목은 그대로 둔다. */
export function maskValue(field: FieldKey, value: string | null): string {
  if (value == null) return "";
  switch (field) {
    case "name": return maskName(value);
    case "phone": return maskPhone(value);
    case "rrn": return maskRrn(value);
    case "address": return maskAddress(value);
    default: return value;
  }
}

export function maskRow(row: ExcelRow): ExcelRow {
  const fields = { ...row.fields };
  (Object.keys(fields) as FieldKey[]).forEach((k) => (fields[k] = maskValue(k, fields[k]) || null));
  return { rowId: row.rowId, fields };
}

export function maskItem(item: ReconcileItem): ReconcileItem {
  return {
    ...item,
    excelValue: item.excelValue == null ? null : maskValue(item.field, item.excelValue),
    registryValue: item.registryValue == null ? null : maskValue(item.field, item.registryValue),
  };
}

// ── 시연판(배포판) 화면용 가리기 ──
// 공개 주소로 올리는 시연판은 가짜 데이터만 쓰지만, 실제처럼 보이는 번호·이름이 그대로 나가지 않게 서버에서 한 번 더 가린다.
// 주민등록번호는 생년월일(앞 6자리)만, 이름은 마지막 글자만 가린다. 이 컴퓨터에서 쓸 때(배포판이 아닐 때)는 가리지 않는다.

/** 이름의 마지막 글자만 가린다. 예: 김소담 → 김소* */
export function demoMaskName(name: string | null): string {
  if (!name) return "";
  const chars = [...name.replace(/\s+/g, "")];
  return chars.length <= 1 ? "*" : `${chars.slice(0, -1).join("")}*`;
}

function demoMaskValue(field: FieldKey, value: string | null): string | null {
  if (value == null || value === "") return value;
  if (field === "name") return demoMaskName(value);
  if (field === "rrn") return maskRrn(value);
  return value;
}

/** 대조 결과(줄·항목)에서 이름과 주민등록번호를 시연판용으로 가린다. 값을 바꾸지 않고 복사본을 돌려준다. */
export function demoMaskPipeline<T extends { rows: ExcelRow[]; items: ReconcileItem[]; phoneMatches?: Array<{ name: string | null }> }>(result: T): T {
  const rows = result.rows.map((r) => ({
    rowId: r.rowId,
    fields: { ...r.fields, name: demoMaskValue("name", r.fields.name), rrn: demoMaskValue("rrn", r.fields.rrn) },
  }));
  const items = result.items.map((i) => ({
    ...i,
    excelValue: demoMaskValue(i.field, i.excelValue),
    registryValue: demoMaskValue(i.field, i.registryValue),
  }));
  const phoneMatches = result.phoneMatches?.map((p) => ({ ...p, name: demoMaskValue("name", p.name) }));
  return { ...result, rows, items, ...(phoneMatches ? { phoneMatches } : {}) };
}
