// Design Ref: §2 ⓑ 글자 → 항목 나누기 — Tesseract.js는 글자와 단어별 확신도만 주므로, 갑구 표의 줄 모양을 기준으로 성명·주민번호 같은 항목으로 나눈다.
// 항목 확신도 = 그 항목을 이루는 단어들의 확신도 중 가장 낮은 값. (실제 등기는 양식이 다를 수 있어 이 파일만 고치면 되도록 따로 둔다.)
// Plan: PLAN.md 12-2번.

import { parseDate } from "../dates";
import type { ReadValue, RegistryOwner, RegistryReading } from "../types";

export interface OcrWord {
  text: string;
  /** 0~100 */
  confidence: number;
}
export interface OcrLine {
  words: OcrWord[];
}

interface Span {
  start: number;
  end: number;
  confidence: number;
}

const isSingleHangul = (s: string) => /^[가-힣]$/.test(s);

/**
 * 단어들을 한 줄 글자로 잇는다. 글꼴 간격 때문에 한글이 한 글자씩 끊겨 읽히는 경우("소 유 권")가 많아서,
 * 한 글자짜리 한글 단어가 이어지면 공백 없이 붙인다.
 */
function joinLine(line: OcrLine): { text: string; spans: Span[] } {
  let text = "";
  let prev = "";
  const spans: Span[] = [];
  for (const w of line.words) {
    const token = w.text.trim();
    if (!token) continue;
    if (text && !(isSingleHangul(prev) && isSingleHangul(token))) text += " ";
    const start = text.length;
    text += token;
    spans.push({ start, end: text.length, confidence: w.confidence });
    prev = token;
  }
  return { text, spans };
}

/** 글자 범위[start,end)와 겹치는 단어들 중 가장 낮은 확신도. 겹치는 단어가 없으면 0. */
function confidenceOf(spans: Span[], start: number, end: number): number {
  const hit = spans.filter((s) => s.start < end && s.end > start);
  return hit.length ? Math.min(...hit.map((s) => s.confidence)) : 0;
}

/** "성명"처럼 글자 사이에 공백이 끼어도 찾도록 글자마다 \s*를 넣은 패턴 조각. */
const kw = (word: string) => [...word].join("\\s*");
const COLON = "\\s*[:：;]\\s*";

const RE_LOT = new RegExp(`^(\\s*${kw("지번주소")}${COLON})(.+?)\\s*$`);
const RE_OWNER = new RegExp(`^(\\s*\\d+\\s*[.)]\\s*${kw("성명")}${COLON})(.+?)(\\s+${kw("주민등록번호")}${COLON})(\\S+)\\s*$`);
const RE_ADDRESS = new RegExp(`^(\\s*${kw("주소")}${COLON})(.+?)\\s*$`);
// 날짜와 "소유종료일" 사이에 `_` 같은 잡음 글자가 끼어도 읽는다.
const RE_DATES = new RegExp(`^(\\s*${kw("소유권이전일")}${COLON})(\\S+)((?:\\s+[_|.,]+)?\\s+${kw("소유종료일")}${COLON})(\\S+)\\s*$`);

const EMPTY: ReadValue = { value: null, confidence: 0 };
const newOwner = (): RegistryOwner => ({
  name: { ...EMPTY }, rrn: { ...EMPTY }, address: { ...EMPTY }, ownershipDate: { ...EMPTY }, ownershipEndDate: { ...EMPTY },
});

/** 읽을 수 없는 그림용 빈 결과. 모든 값이 비어 있고 확신도 0이라 대조에서 "확인 필요"가 된다. */
export const emptyReading = (sourceFile: string): RegistryReading => ({ sourceFile, lotAddress: { ...EMPTY }, owners: [] });

const DASHES = /^[-–—_]+$/;

export function parseRegistryLines(lines: OcrLine[], sourceFile: string): RegistryReading {
  const reading = emptyReading(sourceFile);
  let current: RegistryOwner | null = null;

  for (const line of lines) {
    const { text, spans } = joinLine(line);
    if (!text) continue;

    let m = RE_LOT.exec(text);
    if (m) {
      const start = m[1].length;
      reading.lotAddress = { value: m[2].trim(), confidence: confidenceOf(spans, start, start + m[2].length) };
      continue;
    }
    m = RE_OWNER.exec(text);
    if (m) {
      current = newOwner();
      const nameStart = m[1].length;
      const rrnStart = nameStart + m[2].length + m[3].length;
      current.name = { value: m[2].replace(/\s+/g, ""), confidence: confidenceOf(spans, nameStart, nameStart + m[2].length) };
      current.rrn = { value: m[4], confidence: confidenceOf(spans, rrnStart, rrnStart + m[4].length) };
      reading.owners.push(current);
      continue;
    }
    m = RE_DATES.exec(text);
    if (m && current) {
      const startA = m[1].length;
      const startB = startA + m[2].length + m[3].length;
      current.ownershipDate = { value: parseDate(m[2]) ?? m[2], confidence: confidenceOf(spans, startA, startA + m[2].length) };
      const endConf = confidenceOf(spans, startB, startB + m[4].length);
      current.ownershipEndDate = DASHES.test(m[4]) ? { value: null, confidence: endConf } : { value: parseDate(m[4]) ?? m[4], confidence: endConf };
      continue;
    }
    m = RE_ADDRESS.exec(text);
    if (m && current) {
      const start = m[1].length;
      current.address = { value: m[2].trim(), confidence: confidenceOf(spans, start, start + m[2].length) };
    }
  }
  return reading;
}
