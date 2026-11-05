// AI(LLM)로 읽기가 이 컴퓨터 안에서 읽기(pdfjs·Tesseract)보다 나은지 가짜 샘플 30건으로 잰다.
// 외부 서버로 가짜 파일을 보내고 비용이 들기 때문에 기본으로는 건너뛴다: RUN_LLM=1 일 때만 실행한다.
//   node --env-file=.env node_modules/vitest/vitest.mjs run tests/llm-measure.test.ts   (RUN_LLM=1 필요)
import sampleJson from "@/sample-data/fake-sample.json";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { readManyLlm } from "@/lib/llm/read-llm";
import { isSameValue } from "@/lib/normalize";
import { runPipeline } from "@/lib/pipeline";
import { loadSample } from "@/lib/sample";
import { verifyReading } from "@/lib/verify-loop";
import type { RegistryReading } from "@/lib/types";

const run = process.env.RUN_LLM === "1" ? describe : describe.skip;
const truth = (sampleJson as unknown as { registries: RegistryReading[] }).registries;

function measure(kind: "pdf" | "png", ext: string, dir: string) {
  it(`${kind.toUpperCase()} 30건을 AI로 읽는다`, async () => {
    const started = Date.now();
    const files = truth.map((t) => {
      const name = t.sourceFile.replace(/\.png$/i, ext);
      return { name, path: path.resolve(dir, name) };
    });
    const rounds = await readManyLlm(files, 4);
    const seconds = (Date.now() - started) / 1000;

    const readings = new Map<string, RegistryReading>();
    let total = 0, match = 0, low = 0, ownerCountWrong = 0, wrongButTrusted = 0, calls = 0;
    const wrongByField: Record<string, number> = {};
    for (const t of truth) {
      const name = t.sourceFile.replace(/\.png$/i, ext);
      const r = rounds.get(name)!;
      calls += r.length;
      const outcome = verifyReading((round) => structuredClone(r[Math.min(round, r.length) - 1]));
      const reading = { ...outcome.finalReading, sourceFile: name };
      readings.set(name, reading);
      if (reading.owners.length !== t.owners.length) ownerCountWrong++;
      const cmp = (field: Parameters<typeof isSameValue>[0], a: { value: string | null; confidence: number } | undefined, want: string | null) => {
        total++;
        const same = isSameValue(field, a?.value ?? null, want);
        const trusted = (a?.confidence ?? 0) >= 90;
        if (same) match++;
        else {
          wrongByField[field] = (wrongByField[field] ?? 0) + 1;
          if (wrongByField[field] <= 3) console.log(`  [가짜 데이터] 틀림 ${field}: AI="${a?.value}" 정답="${want}"`);
        }
        if (!trusted) low++;
        if (!same && trusted) wrongButTrusted++; // 틀렸는데 믿을 만하다고 통과한 값 — 가장 위험
      };
      cmp("lotAddress", reading.lotAddress, t.lotAddress.value);
      t.owners.forEach((o, i) => {
        const g = reading.owners[i];
        cmp("name", g?.name, o.name.value);
        cmp("rrn", g?.rrn, o.rrn.value);
        cmp("address", g?.address, o.address.value);
        cmp("ownershipDate", g?.ownershipDate, o.ownershipDate.value);
        cmp("ownershipEndDate", g?.ownershipEndDate, o.ownershipEndDate.value);
      });
    }

    console.log(`[AI ${kind}] 틀린 항목 종류별: ${JSON.stringify(wrongByField)}`);
    const sample = loadSample();
    const res = runPipeline({ rows: sample.rows, city: sample.city, sourceFiles: [...readings.keys()], readRound: (f) => structuredClone(readings.get(f)!) });
    const c = res.stats.counts;
    console.log(
      `[AI ${kind}] 항목 일치율 ${((match / total) * 100).toFixed(1)}% (${match}/${total}), 소유자 수 틀린 등기 ${ownerCountWrong}장, ` +
        `틀렸는데 믿은 값 ${wrongButTrusted}개, 확신도 낮아 확인 필요로 간 값 ${low}개 / 직원이 볼 확인 필요 ${((c["needs-check"] / res.items.length) * 100).toFixed(1)}% ` +
        `${JSON.stringify(c)} / ${seconds.toFixed(0)}초, AI 호출 ${calls}번`,
    );
    expect(total).toBeGreaterThan(0);
  }, 20 * 60_000);
}

run("AI 읽기 측정 (가짜 샘플 30건)", () => {
  measure("pdf", ".pdf", "sample-data/pdfs");
  measure("png", ".png", "sample-data/images");
});
