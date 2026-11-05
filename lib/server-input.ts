// Design Ref: §1 ① 파일 불러오기 — 서버가 정해진 폴더(sample-data/)의 파일을 읽는다. 파일 이름은 실제 파일 목록에 있는 것만 받는다(§9.2).
// 배포판(또는 OCR_MODE가 sample)에서는 미리 읽어 둔 샘플 결과를 쓰고, 이 컴퓨터(local)에서는 엑셀 파일과 등기 그림을 실제로 읽는다.

import { promises as fs } from "node:fs";
import path from "node:path";
import { todayKst } from "./dates";
import { readBillingHistory, readExcelRows, readPhoneRecords } from "./excel-io";
import { llmAvailable, llmModel, readManyLlm } from "./llm/read-llm";
import { readRegistryRoundsLocal } from "./ocr/local";
import { readRegistryPdfRounds } from "./pdf/read-pdf";
import type { PipelineInput } from "./pipeline";
import { isDeployed, ocrMode } from "./runtime-mode";
import { loadSample } from "./sample";
import { pickAllowed, resolveInside } from "./safe-path";
import type { RegistryReading } from "./types";

const SAMPLE_DIR = path.resolve(process.cwd(), "sample-data");
const IMAGE_DIR = path.join(SAMPLE_DIR, "images");
const PDF_DIR = path.join(SAMPLE_DIR, "pdfs");

/** 배포판에서 화면에 보여 주는 파일 이름(실제 파일을 읽지는 않는다). */
const DEMO_FILES = { existing: ["fake-existing.xlsx"], city: ["fake-city-billing.xlsx"], phone: ["fake-phone.xlsx"], imageCount: 100, pdfCount: 100 };

async function listDir(dir: string, pattern: RegExp): Promise<string[]> {
  try {
    return (await fs.readdir(dir)).filter((n) => pattern.test(n)).sort();
  } catch {
    return [];
  }
}

export async function listInputFiles() {
  const today = todayKst();
  if (isDeployed()) return { mode: "sample" as const, deployed: true, today, llm: { available: false, model: "" }, ...DEMO_FILES };
  const all = await listDir(SAMPLE_DIR, /^fake-.*\.xlsx$/);
  return {
    mode: ocrMode(),
    deployed: false,
    today,
    // 키 값은 보내지 않고, 쓸 수 있는지와 모델 이름만 알린다.
    llm: { available: llmAvailable(), model: llmAvailable() ? llmModel() : "" },
    existing: all.filter((n) => !n.includes("city") && !n.includes("phone")),
    city: all.filter((n) => n.includes("city")),
    phone: all.filter((n) => n.includes("phone")),
    imageCount: (await listDir(IMAGE_DIR, /^fake-.*\.png$/)).length,
    pdfCount: (await listDir(PDF_DIR, /\.pdf$/i)).length,
  };
}

/** 직원이 고른 읽기 방법. "llm"은 키가 있고 배포판이 아닐 때만 인정한다(아니면 이 컴퓨터에서 읽기로 돌린다). */
export type Reader = "local" | "llm";

export async function loadInput(selected: { existing?: string; city?: string; phone?: string; reader?: Reader }): Promise<{ input: PipelineInput; mode: "sample" | "local"; reader: Reader }> {
  const reader: Reader = selected.reader === "llm" && llmAvailable() ? "llm" : "local";
  // 샘플 모드(미리 읽어 둔 결과)에서도 AI로 읽기를 고르면 실제로 읽는다.
  const mode = reader === "llm" ? "local" : ocrMode();
  if (mode === "sample") {
    const s = loadSample();
    return { mode, reader, input: { rows: s.rows, city: s.city, phones: s.phones.length > 0 ? s.phones : undefined, sourceFiles: s.sourceFiles, readRound: s.readRound } };
  }

  const files = await listInputFiles();
  const existingName = pickAllowed(selected.existing ?? files.existing[0], files.existing);
  const cityName = pickAllowed(selected.city ?? files.city[0], files.city);
  const rows = await readExcelRows(resolveInside(SAMPLE_DIR, existingName));
  const city = await readBillingHistory(resolveInside(SAMPLE_DIR, cityName));
  // 전화번호 엑셀은 있을 때만 쓴다(없으면 전화번호 대조는 건너뛴다).
  const phoneName = selected.phone ?? files.phone[0];
  const phones = phoneName ? await readPhoneRecords(resolveInside(SAMPLE_DIR, pickAllowed(phoneName, files.phone))) : undefined;

  // 등기 PDF(글자가 들어 있는 파일)가 있으면 글자를 그대로 꺼내 읽고, 없으면 그림(PNG)을 글자 읽기(OCR)로 읽는다.
  const pdfs = await listDir(PDF_DIR, /\.pdf$/i);
  const images = pdfs.length > 0 ? pdfs : await listDir(IMAGE_DIR, /^fake-.*\.png$/);
  const dir = pdfs.length > 0 ? PDF_DIR : IMAGE_DIR;
  let rounds = new Map<string, RegistryReading[]>();
  if (reader === "llm") {
    // AI로 읽기: 파일을 외부 서버(OpenAI)로 보낸다. 몇 개씩 동시에 읽는다.
    rounds = await readManyLlm(images.map((name) => ({ name, path: resolveInside(dir, name) })), 4);
  } else {
    for (const file of images) {
      rounds.set(
        file,
        pdfs.length > 0
          ? await readRegistryPdfRounds(resolveInside(PDF_DIR, file), file)
          : await readRegistryRoundsLocal(resolveInside(IMAGE_DIR, file), file),
      );
    }
  }
  return {
    mode,
    reader,
    input: {
      rows, city, phones, sourceFiles: images,
      readRound: (file, round) => {
        const r = rounds.get(file)!;
        return structuredClone(r[Math.min(round, r.length) - 1]);
      },
    },
  };
}
