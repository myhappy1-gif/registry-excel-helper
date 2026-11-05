// Design Ref: §2 ⓐ — 글자가 들어 있는 등기 PDF 한 건을 읽는다(OCR 없음). 읽을 수 없으면 빈 결과(= 확인 필요)를 돌려준다.
// Plan: PLAN.md 26·28번. 서버에서만 쓴다.

import { promises as fs } from "node:fs";
import { emptyReading } from "../ocr/parse-fields";
import type { RegistryReading } from "../types";
import { extractPdfPages } from "./extract";
import { lotFromFileName, parseRegistryPdf, type PdfParseResult } from "./parse-registry";

/**
 * 등기 PDF 한 건을 읽는다. 지번은 파일 이름 규칙(`산12-3_등기.pdf`)이 있으면 그것을 먼저 쓰고, 없으면 등기 머리글에서 찾는다.
 * PDF의 글자는 항상 같은 값이 나오므로 반복 검증은 한 회차로 충분하다.
 */
export async function readRegistryPdf(filePath: string, sourceFile: string): Promise<PdfParseResult> {
  try {
    const data = new Uint8Array(await fs.readFile(filePath));
    const pages = await extractPdfPages(data);
    return parseRegistryPdf(pages, sourceFile, { lotHint: lotFromFileName(sourceFile) });
  } catch {
    // 열 수 없는 파일: 어떤 내용도 믿지 않고 직원 확인으로 넘긴다.
    return { reading: emptyReading(sourceFile), hasText: false, issues: ["PDF를 열지 못했어요."] };
  }
}

/** 반복 검증 도구가 쓰는 모양: 회차별 읽기 결과 목록 */
export async function readRegistryPdfRounds(filePath: string, sourceFile: string): Promise<RegistryReading[]> {
  const { reading } = await readRegistryPdf(filePath, sourceFile);
  return [reading];
}
