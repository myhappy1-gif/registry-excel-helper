// Design Ref: §2 ⓑ — PDF에서 꺼낸 글자(위치 포함)를 읽어 갑구(소유권에 관한 사항)에서 소유자와 소유 기간을 뽑는다.
// Plan: PLAN.md 26·27번. 화면과 파일에 관계없는 순수 함수라 시험하기 쉽다.
//
// 읽는 규칙 (실제 인터넷등기소 열람본의 모양을 따랐다):
// - 갑구 표는 열(순위번호 · 등기목적 · 접수 · 등기원인 · 권리자)이 있고, 머리줄의 글자 위치로 열을 나눈다.
// - 소유권 보존·이전 등기만 소유자로 본다. 가등기·말소·압류 같은 등기와 을구(근저당의 채무자 등)는 무시한다.
// - 새 소유권 등기가 나오면 그 전 소유자들은 그 접수일에 소유가 끝난 것으로 본다(소유권이전일 = 접수일, DESIGN 8장 임시 가정).
// - 주민등록번호 뒷자리는 열람본에서 `*******`로 가려져 있으므로 있는 그대로(앞 6자리) 옮긴다.
// - PDF 글자에는 OCR 확신도가 없으므로, 모양 검사(이름·날짜·주민번호 앞자리)에 통과하면 100, 아니면 0(= 확인 필요)으로 둔다.

import type { ReadValue, RegistryOwner, RegistryReading } from "../types";
import type { PdfItem, PdfPage } from "./extract";

const strip = (s: string): string => s.replace(/\s+/g, "");
const pad = (n: number): string => String(n).padStart(2, "0");
const ok = (value: string | null): ReadValue => ({ value, confidence: 100 });
const bad = (value: string | null): ReadValue => ({ value, confidence: 0 });

interface Line {
  y: number;
  items: PdfItem[];
}

function toLines(page: PdfPage): Line[] {
  const sorted = [...page].sort((a, b) => b.y - a.y || a.x - b.x);
  const lines: Line[] = [];
  for (const item of sorted) {
    const last = lines[lines.length - 1];
    if (last && Math.abs(last.y - item.y) <= 3) last.items.push(item);
    else lines.push({ y: item.y, items: [item] });
  }
  for (const l of lines) l.items.sort((a, b) => a.x - b.x);
  return lines;
}

const lineText = (l: Line): string => l.items.map((i) => i.str.trim()).join(" ");

// ── 열 위치 ──
// 머리줄의 글자는 칸 가운데에 놓이고, 칸 안의 내용은 왼쪽 맞춤이라 머리줄 글자의 왼쪽 위치로는 열을 나눌 수 없다.
// 그래서 (1) 머리줄 글자의 가운데로 칸 경계를 어림하고 (2) 실제 내용이 시작하는 위치에 맞춰 경계를 바로잡는다.
const COLUMN_LABELS = ["순위번호", "등기목적", "접수", "등기원인", "권리자"] as const;

function findHeaderSpans(line: Line): Array<[number, number]> | null {
  let text = "";
  const starts: number[] = [];
  const ends: number[] = [];
  for (const item of line.items) {
    for (const ch of strip(item.str)) {
      text += ch;
      starts.push(item.x);
      ends.push(item.x + item.width);
    }
  }
  const spans: Array<[number, number]> = [];
  let from = 0;
  for (const label of COLUMN_LABELS) {
    const at = text.indexOf(label, from);
    if (at < 0) return null;
    const last = at + label.length - 1;
    spans.push([Math.min(...starts.slice(at, last + 1)), Math.max(...ends.slice(at, last + 1))]);
    from = at + label.length;
  }
  return spans;
}

/** 칸 경계 4개(2번째~5번째 열의 왼쪽 끝)를 어림한다. 첫 열의 왼쪽 끝은 머리 글자 왼쪽에서 조금 뺀 값. */
function estimateBoundaries(spans: Array<[number, number]>): number[] {
  const out: number[] = [];
  let b = spans[0][0] - 2;
  for (let i = 0; i < 4; i++) {
    const center = (spans[i][0] + spans[i][1]) / 2;
    b = 2 * center - b;
    out.push(b);
  }
  return out;
}

/** 어림한 경계 가까이에서 내용이 실제로 시작하는 가장 왼쪽 위치로 경계를 맞춘다. */
function snapBoundaries(est: number[], starts: number[]): number[] {
  return est.map((b) => {
    const near = starts.filter((x) => x >= b - 8 && x <= b + 12).sort((p, q) => p - q);
    return near.length ? near[0] - 1 : b;
  });
}

const columnOf = (bounds: number[], x: number): number => {
  let c = 0;
  bounds.forEach((b, i) => {
    if (x >= b) c = i + 1;
  });
  return c;
};

// ── 갑구 항목(순위번호 하나) ──
interface Entry {
  cells: string[][]; // 열마다 줄 목록
}

/** 갑구 표를 순위번호 단위로 자른다. */
function collectEntries(pages: PdfPage[]): { entries: Entry[]; foundSection: boolean } {
  const entries: Entry[] = [];
  let section: "pyo" | "gap" | "eul" | null = null;
  let est: number[] | null = null;
  let current: Entry | null = null;
  let foundSection = false;

  for (const page of pages) {
    const body: Line[] = [];
    for (const line of toLines(page)) {
      const flat = strip(lineText(line));
      if (flat.includes("【갑구】")) { section = "gap"; foundSection = true; current = null; continue; }
      if (flat.includes("【을구】")) { section = "eul"; current = null; continue; }
      if (flat.includes("【표제부】")) { section = "pyo"; current = null; continue; }
      if (section !== "gap") continue;
      if (flat.startsWith("열람일시") || /^\d+\/\d+$/.test(flat) || flat.startsWith("[")) continue; // 쪽 머리·꼬리
      if (flat.includes("순위번호")) {
        const spans = findHeaderSpans(line);
        if (spans) est = estimateBoundaries(spans);
        continue;
      }
      body.push(line);
    }
    if (!est || body.length === 0) continue;
    const bounds = snapBoundaries(est, body.flatMap((l) => l.items.map((i) => i.x)));

    for (const line of body) {
      const parts: string[][] = COLUMN_LABELS.map(() => []);
      for (const item of line.items) parts[columnOf(bounds, item.x)].push(item.str.trim());
      const cells = parts.map((p) => (p.length ? [p.join(" ")] : []));
      if (cells[0].length && /^\d+$/.test(strip(cells[0].join("")))) {
        current = { cells: COLUMN_LABELS.map(() => []) };
        entries.push(current);
      }
      if (!current) continue;
      cells.forEach((c, i) => current!.cells[i].push(...c));
    }
  }
  return { entries, foundSection };
}

// ── 날짜 ──
function firstDate(lines: string[]): string | null {
  for (const l of lines) {
    const m = l.match(/(\d{4})\s*년\s*(\d{1,2})\s*월\s*(\d{1,2})\s*일/);
    if (!m) continue;
    const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
    if (mo < 1 || mo > 12 || d < 1 || d > 31) return null;
    return `${y}-${pad(mo)}-${pad(d)}`;
  }
  return null;
}

// ── 권리자 칸 → 소유자들 ──
interface RawOwner {
  name: string;
  rrn: string;
  address: string;
}

const OWNER_LINE = /(?:^|\s)(?:소유자|공유자)?\s*([가-힣][가-힣A-Za-z()·]{1,19})\s+(\d{6})-([0-9*]{7})/;
const STOP_LINE = /^(거래가액|채권최고액|채무자|근저당권자|지분|공유자$|소유자$)/;

function parseOwners(lines: string[]): RawOwner[] {
  const owners: RawOwner[] = [];
  let cur: RawOwner | null = null;
  for (const raw of lines) {
    const line = raw.replace(/지분\s*\d+\s*분의\s*\d+/g, "").trim();
    if (line === "") continue;
    const m = line.match(OWNER_LINE);
    if (m && m[1] !== "소유자" && m[1] !== "공유자") {
      cur = { name: m[1], rrn: `${m[2]}-${m[3]}`, address: "" };
      owners.push(cur);
      const rest = line.slice((m.index ?? 0) + m[0].length).trim();
      if (rest) cur.address = rest;
      continue;
    }
    if (STOP_LINE.test(line)) { cur = null; continue; }
    if (cur) cur.address = `${cur.address} ${line}`.trim();
  }
  return owners;
}

// ── 검증 ──
const validRrnFront = (rrn: string): boolean => {
  const m = rrn.match(/^(\d{2})(\d{2})(\d{2})-/);
  return !!m && Number(m[2]) >= 1 && Number(m[2]) <= 12 && Number(m[3]) >= 1 && Number(m[3]) <= 31;
};
const validName = (name: string): boolean => /^[가-힣A-Za-z()·]{2,20}$/.test(name);
const validAddress = (a: string): boolean => /[가-힣]/.test(a);

const OWNER_PURPOSE = /(보존|이전)/;
const NOT_OWNER_PURPOSE = /(가등기|청구권|말소|압류|가처분|경매|신탁|회복|예고)/;

interface Active {
  raw: RawOwner;
  start: string | null;
  startOk: boolean;
  end: string | null;
  endUncertain: boolean;
}

export interface PdfParseResult {
  reading: RegistryReading;
  /** 글자를 찾지 못해(스캔 그림 등) 읽을 수 없었는지 */
  hasText: boolean;
  /** 사람이 볼 수 있는 안내 (개인정보 없음) */
  issues: string[];
}

/** 헤더에서 국유지(건물) 번지: "[건물] 경기도 ○○시 생연동 442-1 ..." → "생연동 442-1" */
export function lotFromHeader(pages: PdfPage[]): string | null {
  for (const page of pages) {
    for (const line of toLines(page)) {
      const text = lineText(line);
      if (!text.startsWith("[")) continue;
      const after = text.replace(/^\[[^\]]*\]\s*/, "");
      const m = after.match(/([가-힣0-9]+(?:동|리|가))\s*(산?\s*\d+(?:-\d+)?)/);
      if (m) return `${m[1]} ${m[2].replace(/\s+/g, "")}`;
    }
  }
  return null;
}

/** 파일 이름 앞의 국유지 번지 규칙: `산12-3_등기.pdf` → "산12-3". 맞지 않으면 null. */
export function lotFromFileName(fileName: string): string | null {
  const m = fileName.match(/^(.+?)_등기\.pdf$/i);
  return m ? m[1].trim() : null;
}

export function parseRegistryPdf(pages: PdfPage[], sourceFile: string, options: { lotHint?: string | null } = {}): PdfParseResult {
  const issues: string[] = [];
  const total = pages.reduce((n, p) => n + p.length, 0);
  const lot = options.lotHint ?? lotFromHeader(pages);
  const lotValue: ReadValue = lot ? ok(lot) : bad(null);
  if (total < 5) {
    issues.push("PDF 안에서 글자를 찾지 못했어요(스캔한 그림일 수 있어요).");
    return { reading: { sourceFile, lotAddress: bad(lot), owners: [] }, hasText: false, issues };
  }
  if (!lot) issues.push("등기에서 지번을 찾지 못했어요.");

  const { entries, foundSection } = collectEntries(pages);
  if (!foundSection) issues.push("갑구(소유권에 관한 사항)를 찾지 못했어요.");

  let active: Active[] = [];
  const all: Active[] = [];
  let lastDate: string | null = null;
  let parseFailures = 0;

  for (const e of entries) {
    const purpose = strip(e.cells[1].join(""));
    if (!OWNER_PURPOSE.test(purpose) || NOT_OWNER_PURPOSE.test(purpose)) continue;
    const date = firstDate(e.cells[2]);
    const raws = parseOwners(e.cells[4]);
    if (!date || raws.length === 0) {
      parseFailures++;
      continue;
    }
    const partial = /일부/.test(purpose) && !/전부/.test(purpose);
    if (partial) {
      // 일부 지분만 넘어간 경우: 기존 소유자의 소유가 언제 끝났는지 이 글자만으로는 알 수 없다.
      active.forEach((a) => { a.endUncertain = true; });
    } else {
      active.forEach((a) => { a.end = date; });
      active = [];
    }
    const startOk = lastDate === null || date >= lastDate;
    lastDate = date;
    for (const raw of raws) {
      const owner: Active = { raw, start: date, startOk, end: null, endUncertain: false };
      active.push(owner);
      all.push(owner);
    }
  }
  if (parseFailures > 0) issues.push(`소유권 등기 ${parseFailures}건을 해석하지 못했어요.`);
  if (all.length === 0 && foundSection) issues.push("소유자를 찾지 못했어요.");

  const owners: RegistryOwner[] = all.map((a) => ({
    name: validName(a.raw.name) ? ok(a.raw.name) : bad(a.raw.name),
    rrn: validRrnFront(a.raw.rrn) ? ok(a.raw.rrn) : bad(a.raw.rrn),
    address: validAddress(a.raw.address) ? ok(a.raw.address) : bad(a.raw.address || null),
    ownershipDate: a.startOk ? ok(a.start) : bad(a.start),
    ownershipEndDate: a.endUncertain ? bad(a.end) : ok(a.end),
  }));

  // 해석하지 못한 등기가 있으면 소유자 목록이 빠졌을 수 있으니, 지번을 불확실로 표시해 직원 확인으로 보낸다.
  const lotFinal: ReadValue = parseFailures > 0 || !foundSection ? bad(lot) : lotValue;
  return { reading: { sourceFile, lotAddress: lotFinal, owners }, hasText: true, issues };
}
