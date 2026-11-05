// Design Ref: §2 ⓐ·ⓑ — 이 컴퓨터에서 등기 그림 한 장을 회차별(원본 → 흑백·선명 → 확대)로 읽는다.
// 1·2회를 읽어 값이 다르면 3회째까지 읽는다. 읽을 수 없는 그림은 "확인 필요"가 되도록 빈 결과를 돌려준다.
// Plan: PLAN.md 12번. verifyReading(verify-loop)에 회차 결과 목록을 그대로 넘겨 쓴다.

import { promises as fs } from "node:fs";
import { enlarge, sharpen } from "./preprocess";
import { emptyReading, parseRegistryLines } from "./parse-fields";
import { recognizeLines } from "./read-text";
import { diffPaths } from "../verify-loop";
import type { RegistryReading } from "../types";

export async function readRegistryRoundsLocal(imagePath: string, sourceFile: string): Promise<RegistryReading[]> {
  let original: Buffer;
  try {
    original = await fs.readFile(imagePath);
  } catch {
    return [emptyReading(sourceFile)];
  }
  const readWith = async (image: () => Buffer): Promise<RegistryReading> => {
    try {
      return parseRegistryLines(await recognizeLines(image()), sourceFile);
    } catch {
      return emptyReading(sourceFile); // 글자를 읽지 못한 그림 → 확신도 0
    }
  };
  const rounds: RegistryReading[] = [];
  rounds.push(await readWith(() => original)); // 1회: 원본
  rounds.push(await readWith(() => sharpen(original))); // 2회: 흑백·선명
  if (diffPaths(rounds[0], rounds[1]).length > 0) rounds.push(await readWith(() => enlarge(original, 2))); // 3회: 확대
  return rounds;
}
