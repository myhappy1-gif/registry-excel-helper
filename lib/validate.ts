// Design Ref: §9 보안 설계 — 서버 입구로 들어온 값은 그대로 믿지 않고 모양과 길이를 먼저 검사한다.
// 잘못된 값은 쉬운 안내(UserError)와 함께 거부한다.

import { UserError } from "./errors";
import type { PhoneMatchKind } from "./phone-match";
import type { ExcelRow, FieldKey, InputField, InputJob, InputStatus, ReconcileStatus, UnprocessedItem } from "./types";

const MAX_ROWS = 2000;
const MAX_TEXT = 300;
const BAD = () => new UserError("bad-request", "보낸 내용의 모양이 올바르지 않아요. 화면을 새로 고친 뒤 다시 시도해 주세요.");

const FIELD_KEYS: readonly FieldKey[] = [
  "name", "phone", "address", "rrn", "occupiedArea", "ownershipDate", "ownershipEndDate", "lastBillingEndDate", "billingStartDate", "billingEndDate",
];
const INPUT_FIELDS: readonly InputField[] = ["lotAddress", "name", "phone", "address", "rrn"];
const JOB_STATUS: readonly InputStatus[] = ["pending", "done", "skipped", "failed", "excluded"];
const ITEM_STATUS: readonly ReconcileStatus[] = ["same", "filled", "conflict", "needs-check"];

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

function text(v: unknown, allowNull = false): string | null {
  if (v == null && allowNull) return null;
  if (typeof v !== "string" || v.length > MAX_TEXT) throw BAD();
  return v;
}

function rowId(v: unknown) {
  if (!isObject(v)) throw BAD();
  const lotAddress = text(v.lotAddress) as string;
  const ownerIndex = v.ownerIndex;
  if (typeof ownerIndex !== "number" || !Number.isInteger(ownerIndex) || ownerIndex < 1 || ownerIndex > 99) throw BAD();
  return { lotAddress, ownerIndex };
}

function list(v: unknown): unknown[] {
  if (!Array.isArray(v) || v.length > MAX_ROWS) throw BAD();
  return v;
}

export function parseRows(value: unknown): ExcelRow[] {
  return list(value).map((r) => {
    if (!isObject(r) || !isObject(r.fields)) throw BAD();
    const fields = Object.fromEntries(FIELD_KEYS.map((k) => [k, text((r.fields as Record<string, unknown>)[k] ?? null, true)])) as ExcelRow["fields"];
    return { rowId: rowId(r.rowId), fields };
  });
}

export function parseJobs(value: unknown): InputJob[] {
  return list(value).map((j) => {
    if (!isObject(j) || typeof j.approved !== "boolean" || !JOB_STATUS.includes(j.status as InputStatus)) throw BAD();
    return { rowId: rowId(j.rowId), approved: j.approved, status: j.status as InputStatus, reason: text(j.reason ?? null, true) };
  });
}

export function parseUnprocessed(value: unknown): UnprocessedItem[] {
  return list(value).map((u) => {
    if (!isObject(u)) throw BAD();
    const field = u.field == null ? null : (u.field as InputField);
    if (field !== null && !INPUT_FIELDS.includes(field)) throw BAD();
    return { rowId: rowId(u.rowId), field, reason: text(u.reason) as string };
  });
}

/** 리포트에 필요한 건 대조 항목의 상태뿐이다. */
export function parseItemStatuses(value: unknown): Array<{ status: ReconcileStatus }> {
  return list(value).map((i) => {
    if (!isObject(i) || !ITEM_STATUS.includes(i.status as ReconcileStatus)) throw BAD();
    return { status: i.status as ReconcileStatus };
  });
}

const PHONE_KINDS: readonly PhoneMatchKind[] = ["exact", "name", "address", "ambiguous", "none"];

/** 전화번호 대조표를 만들 때 받는 줄들. 값의 모양과 길이만 검사한다. */
export function parsePhoneSheetRows(value: unknown) {
  return list(value).map((r) => {
    if (!isObject(r) || !PHONE_KINDS.includes(r.kind as PhoneMatchKind)) throw BAD();
    return {
      rowKey: text(r.rowKey) as string, name: text(r.name ?? null, true), address: text(r.address ?? null, true),
      excelPhone: text(r.excelPhone ?? null, true), foundPhone: text(r.foundPhone ?? null, true), finalPhone: text(r.finalPhone ?? null, true),
      kind: r.kind as PhoneMatchKind, result: text(r.result) as string,
    };
  });
}

export function parseStringList(value: unknown, max = 100): string[] {
  if (value == null) return [];
  if (!Array.isArray(value) || value.length > max) throw BAD();
  return value.map((v) => text(v) as string);
}

export function parseOptionalName(value: unknown): string | undefined {
  if (value == null || value === "") return undefined;
  return text(value) as string;
}

export function asObject(value: unknown): Record<string, unknown> {
  if (!isObject(value)) throw BAD();
  return value;
}
