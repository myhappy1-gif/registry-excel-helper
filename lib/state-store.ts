// Design Ref: §2 작업 상태 저장(이어하기) — `.work/state.json`에 줄 하나 처리할 때마다 저장해, 앱을 껐다 켜도 중복 입력을 막고 미처리 줄만 이어서 처리한다.
// Plan: PLAN.md 19번. 이 컴퓨터에서만 동작하며 배포판에서는 저장하지 않는다(DESIGN §9.6). 작업이 끝나면 지운다(§9.5).

import { mkdirSync, writeFileSync } from "node:fs";
import { promises as fs } from "node:fs";
import path from "node:path";
import { isDeployed, workDir } from "./runtime-mode";
import type { ExcelRow, InputJob, UnprocessedItem } from "./types";

export interface WorkState {
  updatedAt: string;
  /** 직원이 확정한 엑셀 줄들 (이어서 입력할 때 필요) */
  rows: ExcelRow[];
  jobs: InputJob[];
  unprocessed: UnprocessedItem[];
  stoppedEarly: boolean;
}

const STATE_FILE = "state.json";
const MOCK_FILE = "mock-input.json";

// 작업 폴더 안의 파일 경로. (turbopackIgnore: 폴더 이름이 환경 변수라서 빌드 도구가 프로젝트 전체를 배포물에 넣지 않게 한다. 배포판에서는 이 파일들을 쓰지 않는다.)
const inWork = (name: string): string => path.join(/* turbopackIgnore: true */ workDir(), name);

export async function saveState(state: WorkState): Promise<{ saved: boolean }> {
  if (isDeployed()) return { saved: false };
  await fs.mkdir(workDir(), { recursive: true });
  await fs.writeFile(inWork(STATE_FILE), JSON.stringify(state, null, 2), "utf8");
  return { saved: true };
}

/** 줄 하나 처리할 때마다 바로 저장하는 동기 버전(중간에 앱이 꺼져도 중복 입력을 막기 위해). 배포판에서는 저장하지 않는다. */
export function saveStateSync(state: WorkState): boolean {
  if (isDeployed()) return false;
  mkdirSync(workDir(), { recursive: true });
  writeFileSync(inWork(STATE_FILE), JSON.stringify(state, null, 2), "utf8");
  return true;
}

export async function loadState(): Promise<WorkState | null> {
  if (isDeployed()) return null;
  try {
    return JSON.parse(await fs.readFile(inWork(STATE_FILE), "utf8")) as WorkState;
  } catch {
    return null;
  }
}

/**
 * 모의 입력 기록(.work/mock-input.json)에 이번에 입력한 줄들을 더한다(같은 줄은 새 값으로 바꿈).
 * 이 기록을 정답표와 비교해 일치율을 잰다.
 */
export async function appendMockRecords(records: Array<{ rowKey: string }>): Promise<{ saved: boolean }> {
  if (isDeployed()) return { saved: false };
  await fs.mkdir(workDir(), { recursive: true });
  const file = inWork(MOCK_FILE);
  let existing: Array<{ rowKey: string }> = [];
  try {
    existing = (JSON.parse(await fs.readFile(file, "utf8")) as { records: Array<{ rowKey: string }> }).records;
  } catch {
    /* 처음이면 없다 */
  }
  const merged = new Map(existing.map((r) => [r.rowKey, r]));
  records.forEach((r) => merged.set(r.rowKey, r));
  await fs.writeFile(file, JSON.stringify({ records: [...merged.values()] }, null, 2), "utf8");
  return { saved: true };
}

/** [작업 끝내기·자료 지우기]: 작업 상태와 모의 입력 기록을 지운다. (글자 데이터 캐시는 남긴다) */
export async function clearWorkFiles(): Promise<{ removed: string[] }> {
  if (isDeployed()) return { removed: [] };
  const removed: string[] = [];
  for (const name of [STATE_FILE, MOCK_FILE]) {
    try {
      await fs.rm(inWork(name));
      removed.push(name);
    } catch {
      /* 없으면 넘어간다 */
    }
  }
  return { removed };
}
