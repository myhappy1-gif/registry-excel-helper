// Design Ref: §3 기술 선택 — 이 컴퓨터 안에서만 도는 Tesseract.js로 그림 속 글자를 읽는다(등기 내용이 밖으로 나가지 않음).
// 한국어 글자 데이터는 처음 한 번만 내려받아 `.work/ocr-data/`에 저장하고(깃 제외) 이후에는 그 파일을 쓴다.
// Plan: PLAN.md 12-1번. 서버에서만, 그리고 배포판이 아닐 때만 쓴다.

import { mkdirSync } from "node:fs";
import path from "node:path";
import { createWorker, type Worker } from "tesseract.js";
import { workDir } from "../runtime-mode";
import type { OcrLine } from "./parse-fields";

let workerPromise: Promise<Worker> | null = null;

function getWorker(): Promise<Worker> {
  if (!workerPromise) {
    // 저장 폴더가 미리 없으면 Tesseract.js가 글자 데이터를 저장하지 않고 매번 내려받는다. 그래서 먼저 만든다.
    const cachePath = path.join(/* turbopackIgnore: true */ workDir(), "ocr-data");
    mkdirSync(cachePath, { recursive: true });
    workerPromise = createWorker("kor", 1, { cachePath, logger: () => {} });
  }
  return workerPromise;
}

/** 그림 한 장의 글자를 줄 단위(단어·확신도 포함)로 읽는다. */
export async function recognizeLines(image: Buffer): Promise<OcrLine[]> {
  const worker = await getWorker();
  const { data } = await worker.recognize(image, {}, { blocks: true });
  const lines: OcrLine[] = [];
  for (const block of data.blocks ?? []) {
    for (const paragraph of block.paragraphs) {
      for (const line of paragraph.lines) {
        lines.push({ words: line.words.map((w) => ({ text: w.text, confidence: w.confidence })) });
      }
    }
  }
  return lines;
}

/** 작업이 끝나면 글자 읽기 도구를 끈다. */
export async function terminateOcr(): Promise<void> {
  if (!workerPromise) return;
  const worker = await workerPromise;
  workerPromise = null;
  await worker.terminate();
}
