// Design Ref: §3 폴더 구조 `excel-io.ts` — 엑셀 읽기·저장. 서버에서만 쓴다(ExcelJS).
// Plan: PLAN.md 11·13번. 원본은 읽기 전용이고 수정본은 항상 새 파일로 저장한다. 수식 시작 글자(=,+,-,@)는 앞에 '를 붙인다(DESIGN §9.8).

import ExcelJS from "exceljs";
import { promises as fs } from "node:fs";
import path from "node:path";
import { ERROR_TEXT, UserError } from "./errors";
import { isUsablePhoneRecord, PHONE_KIND_TEXT, type PhoneMatchKind, type PhoneRecord } from "./phone-match";
import { REPORT_LABELS, type ReportSummary } from "./report";
import { assignOwnerIndexes, tidyLot } from "./split-owners";
import type { BillingHistory, ExcelRow, FieldKey } from "./types";

/** 엑셀 열 이름(PRD 6장) ↔ 항목 이름표. */
const EXISTING_COLUMNS: Array<[string, "lotAddress" | FieldKey]> = [
  ["지번주소", "lotAddress"], ["성명", "name"], ["전화번호", "phone"], ["주소", "address"], ["주민등록번호", "rrn"],
  ["점유면적(㎡)", "occupiedArea"], ["소유권이전일", "ownershipDate"], ["소유종료일", "ownershipEndDate"], ["구청 마지막 부과 종료일", "lastBillingEndDate"],
  ["부과 시작일", "billingStartDate"], ["부과 종료일", "billingEndDate"],
];
const CITY_COLUMNS = ["지번주소", "성명", "점유면적(㎡)", "부과 시작일", "부과 종료일"] as const;

/** 수식으로 실행될 수 있는 글자(=,+,-,@)로 시작하면 앞에 '를 붙여 글자로 저장한다. */
export function sanitizeCell(value: string | null): string | null {
  if (value == null) return null;
  return /^[=+\-@]/.test(value) ? `'${value}` : value;
}

function cellText(cell: ExcelJS.Cell): string | null {
  const v = cell.value;
  if (v == null) return null;
  let text: string;
  if (v instanceof Date) text = v.toISOString().slice(0, 10);
  else if (typeof v === "object") {
    if ("richText" in v) text = v.richText.map((t) => t.text).join("");
    else if ("result" in v) text = v.result == null ? "" : String(v.result);
    else if ("text" in v) text = String(v.text);
    else text = "";
  } else text = String(v);
  text = text.trim();
  return text === "" ? null : text;
}

async function loadSheet(source: string | Buffer, requiredHeaders: readonly string[]) {
  const wb = new ExcelJS.Workbook();
  if (typeof source === "string") await wb.xlsx.readFile(source);
  else await wb.xlsx.load(source as unknown as ArrayBuffer);
  const ws = wb.worksheets[0];
  if (!ws) throw new UserError("bad-request", "엑셀에 시트가 없어요.");
  const headerRow = ws.getRow(1);
  const columnOf = new Map<string, number>();
  headerRow.eachCell((cell, col) => {
    const t = cellText(cell);
    if (t) columnOf.set(t, col);
  });
  for (const h of requiredHeaders) {
    if (!columnOf.has(h)) throw new UserError("missing-column", ERROR_TEXT.missingColumn(h));
  }
  return { ws, columnOf };
}

/** 기존 엑셀을 줄 단위로 읽는다. 같은 지번이 여러 줄이면 나온 순서대로 소유자 순번을 붙인다. */
export async function readExcelRows(source: string | Buffer): Promise<ExcelRow[]> {
  const { ws, columnOf } = await loadSheet(source, EXISTING_COLUMNS.map(([h]) => h));
  const raw: Array<{ lotAddress: string; fields: ExcelRow["fields"] }> = [];
  for (let r = 2; r <= ws.rowCount; r++) {
    const row = ws.getRow(r);
    const get = (header: string) => cellText(row.getCell(columnOf.get(header)!));
    const lot = get("지번주소");
    if (!lot) continue;
    const fields = Object.fromEntries(
      EXISTING_COLUMNS.filter(([, key]) => key !== "lotAddress").map(([header, key]) => [key, get(header)]),
    ) as ExcelRow["fields"];
    raw.push({ lotAddress: tidyLot(lot), fields });
  }
  return assignOwnerIndexes(raw).map((r) => ({ rowId: { lotAddress: r.lotAddress, ownerIndex: r.ownerIndex }, fields: r.fields }));
}

/** 구청 부과 이력 엑셀을 읽는다. */
export async function readBillingHistory(source: string | Buffer): Promise<BillingHistory[]> {
  const { ws, columnOf } = await loadSheet(source, CITY_COLUMNS);
  const out: BillingHistory[] = [];
  for (let r = 2; r <= ws.rowCount; r++) {
    const row = ws.getRow(r);
    const get = (header: string) => cellText(row.getCell(columnOf.get(header)!));
    const lot = get("지번주소");
    const start = get("부과 시작일");
    const end = get("부과 종료일");
    if (lot && start && end) {
      out.push({ lotAddress: tidyLot(lot), ownerName: get("성명") ?? "", startDate: start, endDate: end, occupiedArea: get("점유면적(㎡)") });
    }
  }
  return out;
}

/** 전화번호 엑셀(성명·주소·전화번호)을 읽는다. 이름이나 주소 중 하나와 번호가 있는 줄만 쓴다. */
export async function readPhoneRecords(source: string | Buffer): Promise<PhoneRecord[]> {
  const { ws, columnOf } = await loadSheet(source, ["성명", "주소", "전화번호"]);
  const out: PhoneRecord[] = [];
  for (let r = 2; r <= ws.rowCount; r++) {
    const row = ws.getRow(r);
    const get = (header: string) => cellText(row.getCell(columnOf.get(header)!)) ?? "";
    const rec = { name: get("성명"), address: get("주소"), phone: get("전화번호") };
    if (isUsablePhoneRecord(rec)) out.push(rec);
  }
  return out;
}

/** 전화번호 대조표 한 줄(수정본과 따로 내려받는 엑셀). */
export interface PhoneSheetRow {
  rowKey: string;
  name: string | null;
  address: string | null;
  excelPhone: string | null;
  foundPhone: string | null;
  finalPhone: string | null;
  kind: PhoneMatchKind;
  result: string;
}

/** 전화번호 대조표 엑셀: 이름·주소로 전화번호 엑셀과 맞춰 본 결과와 최종 전화번호를 한눈에 보게 한다. */
export async function buildPhoneWorkbook(rows: PhoneSheetRow[]): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("전화번호 대조표");
  ws.addRow(["줄", "성명", "주소", "기존 엑셀 전화번호", "전화번호 엑셀에서 찾은 번호", "최종 전화번호", "찾은 근거", "판단"]);
  for (const r of rows) {
    ws.addRow([r.rowKey, r.name, r.address, r.excelPhone, r.foundPhone, r.finalPhone, PHONE_KIND_TEXT[r.kind], r.result].map((v) => sanitizeCell(v == null ? null : String(v))));
  }
  ws.columns.forEach((c) => { c.width = 22; });
  return Buffer.from(await wb.xlsx.writeBuffer());
}

/** 수정본 엑셀을 메모리에서 만든다(파일로 저장하지 않음 — 배포판에서도 내려받기 가능). */
export async function buildRowsWorkbook(rows: ExcelRow[]): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("수정본");
  ws.addRow(EXISTING_COLUMNS.map(([h]) => h));
  for (const row of rows) {
    ws.addRow(
      EXISTING_COLUMNS.map(([, key]) => sanitizeCell(key === "lotAddress" ? row.rowId.lotAddress : row.fields[key])),
    );
  }
  return Buffer.from(await wb.xlsx.writeBuffer());
}

/** 결과 리포트 엑셀(건수 + 미처리 목록)을 메모리에서 만든다. 개인정보는 담지 않는다. */
export async function buildReportWorkbook(summary: ReportSummary): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("결과 요약");
  ws.addRow(["구분", "건수"]);
  for (const [key, label] of REPORT_LABELS) ws.addRow([label, summary.counts[key]]);
  const wu = wb.addWorksheet("미처리 목록");
  wu.addRow(["줄", "항목", "사유"]);
  for (const u of summary.unprocessed) wu.addRow([sanitizeCell(u.rowKey), u.field, sanitizeCell(u.reason)]);
  return Buffer.from(await wb.xlsx.writeBuffer());
}

/**
 * 수정본을 새 파일로 저장한다. 원본과 같은 경로이거나 폴더 밖이면 거부한다.
 * 왜: 원본 엑셀은 절대 덮어쓰지 않는다(PRD 5장).
 */
export async function saveNewWorkbook(buffer: Buffer, outputDir: string, fileName: string, originalPath?: string): Promise<string> {
  if (fileName !== path.basename(fileName) || !fileName.endsWith(".xlsx")) {
    throw new UserError("bad-file-name", ERROR_TEXT.badFileName);
  }
  const target = path.resolve(outputDir, fileName);
  if (path.relative(path.resolve(outputDir), target).startsWith("..")) throw new UserError("bad-file-name", ERROR_TEXT.badFileName);
  if (originalPath && path.resolve(originalPath) === target) throw new UserError("overwrite-original", ERROR_TEXT.overwriteOriginal);
  await fs.mkdir(outputDir, { recursive: true });
  await fs.writeFile(target, buffer, { flag: "wx" }); // 이미 있으면 덮어쓰지 않고 실패
  return target;
}
