// 이 컴퓨터에서 Tesseract.js로 실제 가짜 등기 그림을 읽어 보는 시험.
// 처음 한 번 한국어 글자 데이터를 내려받고 시간이 걸리므로, 평소 `npm run test`에서는 건너뛴다.
// 실행: RUN_OCR=1 npm run test -- ocr-local   (PowerShell: $env:RUN_OCR=1; npm.cmd run test -- ocr-local)
import sampleJson from "@/sample-data/fake-sample.json";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { readRegistryRoundsLocal } from "@/lib/ocr/local";
import { terminateOcr } from "@/lib/ocr/read-text";
import { isSameValue } from "@/lib/normalize";
import { verifyReading } from "@/lib/verify-loop";
import type { RegistryReading } from "@/lib/types";

const truth = (sampleJson as unknown as { registries: RegistryReading[] }).registries;
const FILES =
  process.env.OCR_FILES === "all"
    ? truth.map((t) => t.sourceFile)
    : (process.env.OCR_FILES ?? "fake-registry-01.png,fake-registry-17.png,fake-registry-25.png").split(",");

describe.skipIf(!process.env.RUN_OCR)("실제 글자 읽기(Tesseract.js, 이 컴퓨터)", () => {
  afterAll(async () => { await terminateOcr(); });

  it("가짜 등기 그림을 읽어 정답과 비교한다", async () => {
    let total = 0;
    let match = 0;
    let high = 0, highWrong = 0, low = 0, lowRight = 0;
    const samples: Array<{ conf: number; ok: boolean }> = [];
    const started = Date.now();
    for (const file of FILES) {
      const t = truth.find((r) => r.sourceFile === file)!;
      const rounds = await readRegistryRoundsLocal(path.resolve("sample-data/images", file), file);
      const out = verifyReading((round) => rounds[Math.min(round, rounds.length) - 1]);
      const got = out.finalReading;
      const cmp = (field: "lotAddress" | "name" | "rrn" | "address" | "ownershipDate" | "ownershipEndDate", a: string | null, b: string | null, conf: number) => {
        total++;
        const ok = isSameValue(field, a, b);
        if (ok) match++;
        else console.log(`  불일치 ${file} ${field}: 읽음="${a}" 정답="${b}" 확신도=${Math.round(conf)}`);
        // 확신도 90% 기준이 맞는지 보기 위한 통계
        if (conf >= 90) { high++; if (!ok) highWrong++; } else { low++; if (ok) lowRight++; }
        samples.push({ conf, ok });
      };
      cmp("lotAddress", got.lotAddress.value, t.lotAddress.value, got.lotAddress.confidence);
      t.owners.forEach((o, i) => {
        const g = got.owners[i];
        for (const f of ["name", "rrn", "address", "ownershipDate", "ownershipEndDate"] as const) cmp(f, g?.[f].value ?? null, o[f].value, g?.[f].confidence ?? 0);
      });
      console.log(`${file}: ${out.rounds}회 읽음, 소유자 ${got.owners.length}/${t.owners.length}명, 확신도 최저 ${Math.min(...got.owners.flatMap((o) => [o.name.confidence, o.rrn.confidence]))}`);
    }
    console.log(`글자 읽기 항목 일치율 ${((match / total) * 100).toFixed(1)}% (${match}/${total}), ${FILES.length}장 ${((Date.now() - started) / 1000).toFixed(1)}초`);
    console.log(`확신도 90 이상 ${high}개 중 틀린 것 ${highWrong}개 / 90 미만 ${low}개 중 맞은 것 ${lowRight}개 (맞는데도 확인 필요로 가는 비율 ${low ? ((lowRight / low) * 100).toFixed(0) : 0}%)`);
    // 확신도 기준을 바꿔 보면: 기준 미만(=확인 필요로 보냄) 개수와, 기준 이상인데 틀린(=놓친) 개수
    for (const t of [50, 60, 70, 75, 80, 85, 90]) {
      const flagged = samples.filter((s) => s.conf < t).length;
      const missed = samples.filter((s) => s.conf >= t && !s.ok).length;
      console.log(`기준 ${t}: 확인 필요로 보냄 ${flagged}/${samples.length} (${((flagged / samples.length) * 100).toFixed(0)}%), 틀렸는데 놓침 ${missed}개`);
    }
    expect(match / total).toBeGreaterThan(0.5); // 읽기 자체가 되는지만 확인한다. 정확도는 로그로 본다.
  }, 300_000);
});
