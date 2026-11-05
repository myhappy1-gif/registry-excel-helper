// Design Ref: §2 ⓐ·ⓑ — 같은 그림을 같은 방법으로 읽으면 결과가 늘 같으므로 회차마다 읽는 방법을 바꾼다.
// 기본 2회, 불일치(이전 회차와 읽은 값이 다름)가 남으면 3회까지. 값이 같아지면 멈추고, 3회 후에도 달라지면 "확인 필요".
// Plan: PLAN.md 9번. 초기값(2~3회)은 constants.ts에서 가져온다.

import { MAX_VERIFY_ROUNDS, MIN_VERIFY_ROUNDS } from "./constants";
import { normalizeValue, type NormalizableField } from "./normalize";
import type { ReadMethod, RegistryReading, RoundReading } from "./types";

/** 회차별 읽는 방법: 1회 원본 → 2회 흑백·선명 → 3회 확대. */
export const ROUND_METHODS: readonly ReadMethod[] = ["original", "sharpened", "enlarged"];

const OWNER_FIELDS = ["name", "rrn", "address", "ownershipDate", "ownershipEndDate"] as const;

/** 등기 읽기 결과를 "자리 이름 → 값" 한 줄짜리 표로 편다. 회차끼리 비교하려는 용도. */
export function flattenReading(reading: RegistryReading): Record<string, string | null> {
  const out: Record<string, string | null> = { lot: reading.lotAddress.value };
  reading.owners.forEach((owner, i) => {
    for (const f of OWNER_FIELDS) out[`owner${i}.${f}`] = owner[f].value;
  });
  return out;
}

function fieldOfPath(path: string): NormalizableField {
  return path === "lot" ? "lotAddress" : (path.split(".")[1] as NormalizableField);
}

/** 두 회차에서 값이 다른 자리들. 표기 차이(공백·날짜 모양)만 다른 것은 같은 값으로 본다. */
export function diffPaths(a: RegistryReading, b: RegistryReading): string[] {
  const fa = flattenReading(a);
  const fb = flattenReading(b);
  const keys = new Set([...Object.keys(fa), ...Object.keys(fb)]);
  return [...keys].filter((k) => {
    const same =
      k in fa && k in fb && normalizeValue(fieldOfPath(k), fa[k]) === normalizeValue(fieldOfPath(k), fb[k]);
    return !same;
  });
}

/** 달라지는 자리의 확신도를 0으로 만든다 → 대조에서 자동으로 "확인 필요"가 된다. */
export function markUnstable(reading: RegistryReading, paths: string[]): RegistryReading {
  const copy = structuredClone(reading);
  for (const p of paths) {
    if (p === "lot") copy.lotAddress.confidence = 0;
    else {
      const m = p.match(/^owner(\d+)\.(.+)$/);
      const owner = m ? copy.owners[Number(m[1])] : undefined;
      if (owner && m) owner[m[2] as (typeof OWNER_FIELDS)[number]].confidence = 0;
    }
  }
  return copy;
}

export interface VerifyOutcome {
  /** 마지막 회차 결과. 3회 후에도 달라진 자리는 확신도 0으로 표시됨 */
  finalReading: RegistryReading;
  /** 실제로 돌린 회차 수 */
  rounds: number;
  /** 3회 후에도 달라진 자리 */
  unstablePaths: string[];
  history: RoundReading[];
}

export function verifyReading(
  readRound: (round: number, method: ReadMethod) => RegistryReading,
  options: { minRounds?: number; maxRounds?: number } = {},
): VerifyOutcome {
  const minRounds = options.minRounds ?? MIN_VERIFY_ROUNDS;
  const maxRounds = options.maxRounds ?? MAX_VERIFY_ROUNDS;
  const history: RoundReading[] = [];
  let unstablePaths: string[] = [];

  for (let round = 1; round <= maxRounds; round++) {
    const method = ROUND_METHODS[Math.min(round, ROUND_METHODS.length) - 1];
    history.push({ round, method, reading: readRound(round, method) });
    if (round < Math.max(minRounds, 2)) continue;
    const diffs = diffPaths(history[round - 2].reading, history[round - 1].reading);
    if (diffs.length === 0) break; // 결과가 같아졌으니 멈춘다
    if (round === maxRounds) unstablePaths = diffs; // 마지막 회차에도 달라지면 확인 필요
  }
  const last = history[history.length - 1].reading;
  return {
    finalReading: unstablePaths.length ? markUnstable(last, unstablePaths) : structuredClone(last),
    rounds: history.length,
    unstablePaths,
    history,
  };
}
