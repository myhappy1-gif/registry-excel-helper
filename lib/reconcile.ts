// Design Ref: §2 ⓔ 대조 — 엑셀 빈칸만 등기로 자동 보완하고, 값이 다르면 수정하지 않고 "충돌", 읽은 글자가 불확실하면 "확인 필요".
// Plan: PLAN.md 8번. 짝짓기(match-rows)와 확신도 기준(constants)을 쓴다. 모든 항목에 출처·회차를 남긴다.

import { CONFIDENCE_THRESHOLD } from "./constants";
import { compareDates, parseDate } from "./dates";
import { matchOwners } from "./match-rows";
import { lookupPhone, type PhoneLookup, type PhoneRecord } from "./phone-match";
import { isBlank, isFrontOnlyRrn, isSameValue, normalizeValue, rrnFront } from "./normalize";
import { formatRowId } from "./row-id";
import { splitOwners, tidyLot, type SplitOwner } from "./split-owners";
import type {
  BillingHistory, ExcelRow, FieldKey, ReadValue, ReconcileItem, ReconcileStatus, RegistryReading, RowId,
} from "./types";

/** 등기에서 읽어 대조하는 항목. (전화번호는 엑셀에서만, 구청 마지막 부과 종료일은 구청 엑셀에서 온다) */
export const REGISTRY_FIELDS = ["name", "address", "rrn", "ownershipDate", "ownershipEndDate"] as const satisfies readonly FieldKey[];

export interface ReconcileInput {
  rows: ExcelRow[];
  /** 반복 검증을 마친 등기 읽기 결과들 */
  readings: RegistryReading[];
  city: BillingHistory[];
  /** 전화번호 엑셀의 기록들. 있으면 전화번호를 이 기록과 맞춰 본다(없으면 예전처럼 새 줄만 직접 입력을 요청). */
  phones?: PhoneRecord[];
  /** 등기 그림별로 실제 돌린 회차 수 (기록용) */
  roundsBySource?: Record<string, number>;
}

/** 전화번호 대조 결과 한 줄(화면의 "전화번호" 표와 전화번호 대조표 엑셀에 쓴다). */
export interface PhoneMatchInfo {
  rowId: RowId;
  name: string | null;
  address: string | null;
  /** 기존 엑셀의 전화번호 */
  excelPhone: string | null;
  kind: PhoneLookup["kind"];
  /** 전화번호 엑셀에서 찾은 번호(근거가 하나일 때) */
  found: string | null;
  candidates: string[];
  /** same 같음 · filled 빈칸 보완 · conflict 번호가 다름 · candidate 후보(확인 필요) · ambiguous 번호 여러 개 · not-found 못 찾음 · kept 참고만(엑셀 값 유지) */
  result: "same" | "filled" | "conflict" | "candidate" | "ambiguous" | "not-found" | "kept";
}

export interface ReconcileResult {
  phoneMatches: PhoneMatchInfo[];
  items: ReconcileItem[];
  /** 자동 보완을 반영한 엑셀 줄들 (충돌·확인 필요 항목은 엑셀 값 그대로) */
  rows: ExcelRow[];
  /** 새로 추가된 소유자 줄 이름들 */
  newRowKeys: string[];
  /** 엑셀에만 있는 줄 이름들 */
  orphanRowKeys: string[];
}

const NOTE = {
  low: "읽은 글자가 정확한지 자신이 없어요.",
  unreadable: "등기에서 값을 읽지 못했어요.",
  wins: (before: string | null) => `등기 기준으로 고쳤어요. (엑셀에는 ${before ?? "(비어 있음)"}로 적혀 있었어요.)`,
  winsClear: (before: string | null) => `등기상 현재 소유자라서 소유종료일을 비웠어요. (엑셀에는 ${before ?? ""}로 적혀 있었어요.)`,
  conflict: "엑셀과 등기의 값이 달라요.",
  filled: "엑셀 빈칸을 채웠어요.",
  orphan: "등기에서 이 줄과 짝이 맞는 소유자를 찾지 못했어요.",
  maskedRrn: "등기에는 주민등록번호 뒷자리가 가려져 있어요. 엑셀이 비어 있으니 번호를 직접 입력해 주세요.",
  maskedRrnDiff: "등기의 주민등록번호 앞 6자리(생년월일)가 엑셀과 달라요. 같은 사람인지 확인해 주세요.",
} as const;

const DATE_FIELDS: ReadonlySet<FieldKey> = new Set(["ownershipDate", "ownershipEndDate", "lastBillingEndDate"]);
/** 저장할 때는 날짜를 `YYYY-MM-DD`로 통일한다. */
const stored = (field: FieldKey, value: string | null): string | null =>
  value == null ? null : DATE_FIELDS.has(field) ? (parseDate(value) ?? value) : value;

/**
 * 등기가 값을 정하는 항목 (직원 결정, 2026-11-05). 소유기간은 등기 갑구가 가장 정확한 기준이라,
 * 엑셀과 달라도 충돌로 묻지 않고 등기 값으로 고친다. 단, 읽은 값이 믿을 만할 때(확신도 기준 이상)만이다.
 * 고친 내용은 "자동 보완" 목록에 엑셀 값과 함께 남겨 직원이 훑어볼 수 있게 한다.
 */
export const REGISTRY_WINS_FIELDS: ReadonlySet<FieldKey> = new Set<FieldKey>(["ownershipDate", "ownershipEndDate"]);

function judge(field: FieldKey, excelValue: string | null, rv: ReadValue): { status: ReconcileStatus; fill: string | null; note?: string; wins?: true } {
  const low = rv.confidence < CONFIDENCE_THRESHOLD;
  const regBlank = isBlank(rv.value);
  const excelBlank = isBlank(excelValue);

  if (low) {
    // 읽은 글자가 불확실해도 엑셀 값과 같으면 문제 없다. 그 밖에는 자동으로 고치지 않고 확인을 받는다.
    if (!regBlank && !excelBlank && isSameValue(field, excelValue, rv.value)) return { status: "same", fill: null };
    return { status: "needs-check", fill: null, note: NOTE.low };
  }
  if (field === "rrn" && !regBlank && isFrontOnlyRrn(rv.value)) {
    // 등기 열람본은 뒷자리가 가려져 있다: 앞 6자리(생년월일 부분)만 비교하고, 빈칸을 가려진 번호로 채우지 않는다.
    if (excelBlank) return { status: "needs-check", fill: null, note: NOTE.maskedRrn };
    return rrnFront(excelValue) === rrnFront(rv.value)
      ? { status: "same", fill: null }
      : { status: "conflict", fill: null, note: NOTE.maskedRrnDiff };
  }
  if (regBlank) {
    if (excelBlank) return { status: "same", fill: null };
    // 등기상 현재 소유자인데 엑셀에 소유종료일이 있으면, 등기 기준으로 비운다.
    if (field === "ownershipEndDate") return { status: "filled", fill: null, wins: true, note: NOTE.winsClear(excelValue) };
    return { status: "needs-check", fill: null, note: NOTE.unreadable };
  }
  if (excelBlank) return { status: "filled", fill: stored(field, rv.value), note: NOTE.filled };
  if (isSameValue(field, excelValue, rv.value)) return { status: "same", fill: null };
  if (REGISTRY_WINS_FIELDS.has(field)) return { status: "filled", fill: stored(field, rv.value), wins: true, note: NOTE.wins(excelValue) };
  return { status: "conflict", fill: null, note: NOTE.conflict };
}

/** 전화번호 판단. 이름·주소가 모두 같은 기록만 빈칸을 채우고, 나머지 근거는 후보로만 보여 직원이 정한다. */
function judgePhone(
  excelPhone: string | null,
  lk: PhoneLookup,
): { status: ReconcileStatus | null; fill: string | null; shown: string | null; note?: string; result: PhoneMatchInfo["result"] } {
  const excelBlank = isBlank(excelPhone);
  const sameAsExcel = lk.candidates.some((c) => isSameValue("phone", c, excelPhone));
  if (excelBlank) {
    if (lk.kind === "exact") return { status: "filled", fill: lk.phone, shown: lk.phone, note: "전화번호 엑셀에서 이름·주소가 모두 같은 기록을 찾아 채웠어요.", result: "filled" };
    if (lk.kind === "name") return { status: "needs-check", fill: null, shown: lk.phone, note: "전화번호 엑셀에서 이름만 같은 기록을 찾았어요. 같은 사람인지 확인해 주세요.", result: "candidate" };
    if (lk.kind === "address") return { status: "needs-check", fill: null, shown: lk.phone, note: "전화번호 엑셀에서 주소만 같은 기록을 찾았어요. 같은 사람인지 확인해 주세요.", result: "candidate" };
    if (lk.kind === "ambiguous") return { status: "needs-check", fill: null, shown: null, note: "전화번호 엑셀에 같은 근거로 번호가 여러 개 있어요. 직접 입력해 주세요.", result: "ambiguous" };
    return { status: "needs-check", fill: null, shown: null, note: "전화번호 엑셀에서도 찾지 못했어요. 직접 입력해 주세요.", result: "not-found" };
  }
  if (sameAsExcel) return { status: "same", fill: null, shown: lk.phone, result: "same" };
  // 엑셀에 번호가 있는데 달라도, 이름·주소가 모두 같은 기록일 때만 충돌로 본다(이름만·주소만 같은 기록은 다른 사람일 수 있어 참고만).
  if (lk.kind === "exact") return { status: "conflict", fill: null, shown: lk.phone, note: "기존 엑셀과 전화번호 엑셀의 전화번호가 달라요.", result: "conflict" };
  return { status: null, fill: null, shown: lk.phone, result: "kept" };
}

export function reconcile(input: ReconcileInput): ReconcileResult {
  // 엑셀 줄 복사 (지번주소 공백만 정리)
  const rows: ExcelRow[] = input.rows.map((r) => ({
    rowId: { lotAddress: tidyLot(r.rowId.lotAddress), ownerIndex: r.rowId.ownerIndex },
    fields: { ...r.fields },
  }));
  const splits = input.readings.flatMap(splitOwners);
  const { pairs, newOwners, orphans } = matchOwners(splits, rows);

  type Info = { kind: "pair" | "new"; split: SplitOwner } | { kind: "orphan" };
  const info = new Map<string, Info>();
  const lotKey = (lot: string) => normalizeValue("lotAddress", lot);

  pairs.forEach(({ split, excel }) => info.set(formatRowId(excel.rowId), { kind: "pair", split }));
  orphans.forEach((r) => info.set(formatRowId(r.rowId), { kind: "orphan" }));

  // 새 소유자는 같은 지번의 마지막 줄 바로 뒤에 새 줄로 넣는다.
  const maxIndex = new Map<string, number>();
  rows.forEach((r) => maxIndex.set(lotKey(r.rowId.lotAddress), Math.max(maxIndex.get(lotKey(r.rowId.lotAddress)) ?? 0, r.rowId.ownerIndex)));
  for (const split of newOwners) {
    const key = lotKey(split.rowId.lotAddress);
    const existing = rows.filter((r) => lotKey(r.rowId.lotAddress) === key);
    const lotAddress = existing[0]?.rowId.lotAddress ?? split.rowId.lotAddress;
    const ownerIndex = (maxIndex.get(key) ?? 0) + 1;
    maxIndex.set(key, ownerIndex);
    const row: ExcelRow = {
      rowId: { lotAddress, ownerIndex },
      fields: {
        name: null, phone: null, address: null, rrn: null, occupiedArea: null, ownershipDate: null, ownershipEndDate: null,
        lastBillingEndDate: null, billingStartDate: null, billingEndDate: null,
      },
    };
    const lastIdx = rows.map((r) => lotKey(r.rowId.lotAddress)).lastIndexOf(key);
    rows.splice(lastIdx >= 0 ? lastIdx + 1 : rows.length, 0, row);
    info.set(formatRowId(row.rowId), { kind: "new", split });
  }

  // 구청 엑셀: 같은 지번 기록 중 가장 늦은 부과 종료일
  const cityLast = new Map<string, string>();
  for (const c of input.city) {
    const end = parseDate(c.endDate);
    if (!end) continue;
    const k = lotKey(c.lotAddress);
    const prev = cityLast.get(k);
    if (!prev || compareDates(end, prev) > 0) cityLast.set(k, end);
  }

  // 구청 엑셀의 점유면적: 같은 지번·같은 이름의 가장 늦은 기록을 쓰고,
  // 이름이 없으면(소유자 교체 등) 그 지번의 기록들이 같은 면적일 때만 그 값을 쓴다. 값은 바꾸지 않고 옮기기만 한다.
  const areaByOwner = new Map<string, { end: string; area: string }>();
  const areasByLot = new Map<string, Set<string>>();
  for (const c of input.city) {
    if (isBlank(c.occupiedArea)) continue;
    const end = parseDate(c.endDate) ?? "";
    const lk = lotKey(c.lotAddress);
    const ok = `${lk}|${normalizeValue("name", c.ownerName)}`;
    const prev = areaByOwner.get(ok);
    if (!prev || end > prev.end) areaByOwner.set(ok, { end, area: c.occupiedArea as string });
    const set = areasByLot.get(lk) ?? new Set<string>();
    set.add(normalizeValue("occupiedArea", c.occupiedArea));
    areasByLot.set(lk, set);
  }
  const areaOf = (lotAddress: string, name: string | null): string | null => {
    const lk = lotKey(lotAddress);
    const byName = areaByOwner.get(`${lk}|${normalizeValue("name", name)}`);
    if (byName) return byName.area;
    const set = areasByLot.get(lk);
    if (set && set.size === 1) {
      const any = [...areaByOwner.entries()].find(([k]) => k.startsWith(`${lk}|`));
      return any ? any[1].area : null;
    }
    return null;
  };

  const items: ReconcileItem[] = [];
  const phoneMatches: PhoneMatchInfo[] = [];
  const newRowKeys: string[] = [];
  const orphanRowKeys: string[] = [];

  for (const row of rows) {
    const key = formatRowId(row.rowId);
    const meta = info.get(key);
    if (!meta) continue;

    if (meta.kind === "orphan") {
      orphanRowKeys.push(key);
      items.push({
        rowId: row.rowId, field: "name", excelValue: row.fields.name, registryValue: null,
        status: "needs-check", source: { kind: "excel", note: "엑셀에만 있는 줄" }, round: 1, note: NOTE.orphan,
      });
      continue;
    }

    const isNew = meta.kind === "new";
    if (isNew) newRowKeys.push(key);
    const round = input.roundsBySource?.[meta.split.sourceFile] ?? 1;

    for (const field of REGISTRY_FIELDS) {
      const rv = meta.split.owner[field];
      const excelValue = row.fields[field];
      const verdict = judge(field, excelValue, rv);
      if (verdict.status === "filled") row.fields[field] = verdict.fill;
      items.push({
        rowId: row.rowId, field, excelValue, registryValue: rv.value, status: verdict.status,
        source: { kind: "registry", file: meta.split.sourceFile, round }, round,
        confidence: rv.confidence, note: verdict.note, ...(isNew ? { isNewRow: true } : {}), ...(verdict.wins ? { registryWins: true } : {}),
      });
    }

    // 전화번호는 등기에 없으므로 전화번호 엑셀과 이름·주소로 맞춰 본다. (전화번호 엑셀이 없으면 새 줄만 직접 입력을 요청한다.)
    if (input.phones) {
      const lk = lookupPhone(row.fields.name, row.fields.address, input.phones);
      const excelPhone = row.fields.phone;
      const v = judgePhone(excelPhone, lk);
      phoneMatches.push({
        rowId: row.rowId, name: row.fields.name, address: row.fields.address, excelPhone, kind: lk.kind,
        found: lk.phone, candidates: lk.candidates, result: v.result,
      });
      if (v.status) {
        if (v.status === "filled") row.fields.phone = v.fill;
        items.push({
          rowId: row.rowId, field: "phone", excelValue: excelPhone, registryValue: v.shown, status: v.status,
          source: { kind: "phone-excel", note: "전화번호 엑셀" }, round: 1, note: v.note, ...(isNew ? { isNewRow: true } : {}),
        });
      }
    } else if (isNew) {
      items.push({
        rowId: row.rowId, field: "phone", excelValue: null, registryValue: null, status: "needs-check",
        source: { kind: "excel", note: "전화번호는 기존 엑셀에서만 가져와요" }, round, isNewRow: true,
        note: "새로 추가된 줄이라 전화번호를 직접 입력해야 해요.",
      });
    }

    // 구청 마지막 부과 종료일 (구청 엑셀에 같은 지번 이력이 있을 때만)
    const city = cityLast.get(lotKey(row.rowId.lotAddress));
    if (city) {
      const excelValue = row.fields.lastBillingEndDate;
      const verdict = judge("lastBillingEndDate", excelValue, { value: city, confidence: 100 });
      if (verdict.status === "filled") row.fields.lastBillingEndDate = verdict.fill;
      items.push({
        rowId: row.rowId, field: "lastBillingEndDate", excelValue, registryValue: city, status: verdict.status,
        source: { kind: "city-excel", note: "구청 부과 이력에서 가장 늦은 종료일" }, round: 1,
        note: verdict.note, ...(isNew ? { isNewRow: true } : {}),
      });
    }

    // 점유면적 (구청 엑셀에 있을 때만): 빈칸이면 채우고, 다르면 충돌로 직원이 정한다.
    const area = areaOf(row.rowId.lotAddress, row.fields.name);
    if (area) {
      const excelValue = row.fields.occupiedArea;
      const verdict = judge("occupiedArea", excelValue, { value: area, confidence: 100 });
      if (verdict.status === "filled") row.fields.occupiedArea = verdict.fill;
      items.push({
        rowId: row.rowId, field: "occupiedArea", excelValue, registryValue: area, status: verdict.status,
        source: { kind: "city-excel", note: "구청 엑셀의 점유면적" }, round: 1,
        note: verdict.status === "conflict" ? "기존 엑셀과 구청 엑셀의 점유면적이 달라요." : verdict.note,
        ...(isNew ? { isNewRow: true } : {}),
      });
    }
  }
  return { items, rows, newRowKeys, orphanRowKeys, phoneMatches };
}
