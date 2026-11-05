// Design Ref: §3 임시 보관과 배포 — 배포판은 "샘플 데이터 시연 모드"라, 미리 읽어 둔 결과를 그대로 쓴다. (서버에서만 불러온다)
// 샘플은 scripts/make-sample.mjs 가 만든 가짜 데이터다. 실제 등기·개인정보가 아니다.

import sampleJson from "@/sample-data/fake-sample.json";
import type { PhoneRecord } from "./phone-match";
import type { BillingHistory, ExcelRow, RegistryReading } from "./types";

export interface AnswerKeyEntry {
  lotAddress: string;
  ownerName: string;
  field: string;
  kind: "blank" | "conflict" | "format-same" | "new-owner" | "orphan" | "low-confidence" | "unstable";
  expectedStatus: "filled" | "conflict" | "same" | "needs-check";
  correctValue: string | null;
}

interface SampleFile {
  registries: RegistryReading[];
  registryRounds: Record<string, RegistryReading[]>;
  excelRows: ExcelRow[];
  city: BillingHistory[];
  /** 가짜 전화번호 엑셀의 기록들(npm run sample:phone으로 만든다) */
  phones?: PhoneRecord[];
  /** 30번째 이후 지번의 부과 사례 이름표 */
  cases?: Array<{ lotAddress: string; tag: string }>;
  answerKey: AnswerKeyEntry[];
}

const data = sampleJson as unknown as SampleFile;

export function loadSample() {
  const sourceFiles = data.registries.map((r) => r.sourceFile);
  return {
    rows: structuredClone(data.excelRows),
    city: structuredClone(data.city),
    phones: structuredClone(data.phones ?? []),
    cases: data.cases ?? [],
    sourceFiles,
    answerKey: data.answerKey,
    /** 미리 읽어 둔 회차별 결과. 회차가 모자라면 마지막 회차를 쓴다. */
    readRound(sourceFile: string, round: number): RegistryReading {
      const rounds = data.registryRounds[sourceFile];
      if (!rounds) throw new Error("sample reading not found");
      return structuredClone(rounds[Math.min(round, rounds.length) - 1]);
    },
  };
}
