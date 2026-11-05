// 글자 읽기 "확인 필요" 비율을 줄일 방법을 비교하는 측정용 시험 (평소 건너뜀).
// 실행: $env:RUN_OCR_TUNE=1; npm.cmd run test -- ocr-tune   (처음엔 그림 30장 × 여러 방법이라 몇 분 걸림, 결과는 .work/tune-cache.json에 저장)
// 값 자체(이름·주민번호)는 출력하지 않고 개수만 낸다.
import sampleJson from "@/sample-data/fake-sample.json";
import { existsSync, mkdirSync, readFileSync, writeFileSync, promises as fs } from "node:fs";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { CONFIDENCE_THRESHOLD } from "@/lib/constants";
import { isSameValue, normalizeValue, rrnFront } from "@/lib/normalize";
import { formatRowId } from "@/lib/row-id";
import { tidyLot } from "@/lib/split-owners";
import { emptyReading, parseRegistryLines } from "@/lib/ocr/parse-fields";
import { enlarge, sharpen } from "@/lib/ocr/preprocess";
import { recognizeLines, terminateOcr } from "@/lib/ocr/read-text";
import { runPipeline } from "@/lib/pipeline";
import { loadSample } from "@/lib/sample";
import { verifyReading } from "@/lib/verify-loop";
import type { ReadValue, RegistryOwner, RegistryReading } from "@/lib/types";

const truth = (sampleJson as unknown as { registries: RegistryReading[] }).registries;
const CACHE = path.resolve(process.env.TUNE_CACHE ?? ".work/tune-cache.json");
type Cache = Record<string, Record<string, RegistryReading>>; // 방법 이름 → 파일 이름 → 읽은 결과

const VARIANTS: Record<string, { prep: (b: Buffer) => Buffer }> = {
  orig: { prep: (b) => b },
  sharp: { prep: (b) => sharpen(b) },
  enl2: { prep: (b) => enlarge(b, 2) },
  enl3: { prep: (b) => enlarge(b, 3) },
  sharpEnl2: { prep: (b) => sharpen(enlarge(b, 2)) },
  enl2Sharp: { prep: (b) => enlarge(sharpen(b), 2) },
};

const FIELDS = ["name", "rrn", "address", "ownershipDate", "ownershipEndDate"] as const;
const blank = (): ReadValue => ({ value: null, confidence: 0 });
const emptyOwner = (): RegistryOwner => ({ name: blank(), rrn: blank(), address: blank(), ownershipDate: blank(), ownershipEndDate: blank() });

/** 여러 방법으로 읽은 결과를 항목별 다수결로 합친다. 같은 값이 minVotes번 이상 나오면 믿는다(확신도를 trust로). */
function vote(readings: RegistryReading[], file: string, minVotes: number, trust: number): RegistryReading {
  const pick = (field: string, get: (r: RegistryReading) => ReadValue | undefined): ReadValue => {
    const groups = new Map<string, { value: string | null; votes: number; best: number }>();
    for (const r of readings) {
      const v = get(r) ?? blank();
      const key = String(normalizeValue(field as never, v.value));
      const g = groups.get(key) ?? { value: v.value, votes: 0, best: 0 };
      g.votes++;
      if (v.confidence >= g.best) { g.best = v.confidence; g.value = v.value; }
      groups.set(key, g);
    }
    const top = [...groups.values()].sort((a, b) => b.votes - a.votes || b.best - a.best)[0];
    return { value: top.value, confidence: top.votes >= minVotes && top.value !== null ? Math.max(top.best, trust) : top.best };
  };
  const nOwners = Math.max(...readings.map((r) => r.owners.length));
  const owners: RegistryOwner[] = [];
  for (let i = 0; i < nOwners; i++) {
    const o = emptyOwner();
    for (const f of FIELDS) o[f] = pick(f, (r) => r.owners[i]?.[f]);
    owners.push(o);
  }
  return { sourceFile: file, lotAddress: pick("lotAddress", (r) => r.lotAddress), owners };
}

describe.skipIf(!process.env.RUN_OCR_TUNE)("확인 필요 비율 줄이기 비교", () => {
  afterAll(async () => { await terminateOcr(); });

  it("방법별 비교", async () => {
    const files = truth.map((t) => t.sourceFile);
    const cache: Cache = existsSync(CACHE) ? JSON.parse(readFileSync(CACHE, "utf8")) : {};
    let dirty = false;
    for (const [name, { prep }] of Object.entries(VARIANTS)) {
      cache[name] ??= {};
      for (const file of files) {
        if (cache[name][file]) continue;
        const buf = await fs.readFile(path.resolve("sample-data/images", file));
        try { cache[name][file] = parseRegistryLines(await recognizeLines(prep(buf)), file); }
        catch { cache[name][file] = emptyReading(file); }
        dirty = true;
      }
    }
    if (dirty) { mkdirSync(path.dirname(CACHE), { recursive: true }); writeFileSync(CACHE, JSON.stringify(cache)); }

    const sample = loadSample();
    const baseline = runPipeline({ rows: sample.rows, city: sample.city, sourceFiles: sample.sourceFiles, readRound: sample.readRound });
    const bf: Record<string, number> = {};
    baseline.items.filter((i) => i.status === "filled").forEach((i) => { const k = i.field + (i.isNewRow ? "(새줄)" : ""); bf[k] = (bf[k] ?? 0) + 1; });
    console.log(`  보완 분류 [기준] ${JSON.stringify(bf)}`);
    console.log(`[기준] 정답 그대로 읽었을 때 건수 ${JSON.stringify(baseline.stats.counts)} / 전체 ${baseline.items.length}건`);

    const evaluate = (label: string, get: (file: string) => RegistryReading) => {
      let total = 0, flagged = 0, wrong = 0, missed = 0;
      for (const t of truth) {
        const g = get(t.sourceFile);
        const cmp = (field: string, a: ReadValue | undefined, b: string | null) => {
          total++;
          const ok = isSameValue(field as never, a?.value ?? null, b);
          const conf = a?.confidence ?? 0;
          if (!ok) wrong++;
          if (conf < CONFIDENCE_THRESHOLD) flagged++;
          else if (!ok) missed++;
        };
        cmp("lotAddress", g.lotAddress, t.lotAddress.value);
        t.owners.forEach((o, i) => FIELDS.forEach((f) => cmp(f, g.owners[i]?.[f], o[f].value)));
      }
      const res = runPipeline({ rows: sample.rows, city: sample.city, sourceFiles: sample.sourceFiles, readRound: (f) => get(f) });
      const c = res.stats.counts;
      // 틀린 값이 조용히 들어갔는지: 보완(filled) 중 정답과 다른 것, 충돌 중 가짜 충돌
      const sameLot = (a: string, b: string) => normalizeValue("lotAddress", tidyLot(a)) === normalizeValue("lotAddress", tidyLot(b));
      let filledWrong = 0, conflictFalse = 0, conflictTrue = 0;
      for (const it of res.items) {
        if (it.status !== "filled" && it.status !== "conflict") continue;
        const row = res.rows.find((r) => formatRowId(r.rowId) === formatRowId(it.rowId))!;
        const tr = truth.find((x) => sameLot(x.lotAddress.value ?? "", row.rowId.lotAddress));
        const to = tr?.owners.find((o) => normalizeValue("name", o.name.value) === normalizeValue("name", row.fields.name) || (rrnFront(row.fields.rrn) !== "" && rrnFront(o.rrn.value) === rrnFront(row.fields.rrn)));
        const want = (to as unknown as Record<string, ReadValue> | undefined)?.[it.field]?.value;
        if (want === undefined) continue; // 정답표에 없는 항목(전화번호 등)
        const ok = isSameValue(it.field, it.registryValue, want ?? null);
        if (it.status === "filled" && !ok) filledWrong++;
        if (it.status === "conflict") { if (ok) conflictTrue++; else conflictFalse++; }
      }
      const byField: Record<string, number> = {};
      res.items.filter((i) => i.status === "filled").forEach((i) => { byField[i.field + (i.isNewRow ? "(새줄)" : "")] = (byField[i.field + (i.isNewRow ? "(새줄)" : "")] ?? 0) + 1; });
      if (label.startsWith("다수결 3") || label.startsWith("현재")) console.log(`  보완 분류 ${label}: ${JSON.stringify(byField)}`);
      console.log(
        `${label.padEnd(26)} 항목 ${total}: 기준 미만 ${flagged} (${((flagged / total) * 100).toFixed(0)}%), 틀린 값 ${wrong}, 놓침 ${missed}` +
          ` | 실제 대조: 확인 필요 ${c["needs-check"]} / 충돌 ${c.conflict} / 보완 ${c.filled} / 같음 ${c.same} (확인 필요 ${((c["needs-check"] / res.items.length) * 100).toFixed(0)}%)` +
          ` | 틀린 값 조용히 보완 ${filledWrong}, 충돌 진짜 ${conflictTrue}·가짜 ${conflictFalse}`,
      );
      return { flagged, missed, needs: c["needs-check"], items: res.items.length };
    };

    // 지금 방식: 원본 → 흑백·선명 → (다르면) 확대 2배
    const current = (file: string): RegistryReading => {
      const r = [cache.orig[file], cache.sharp[file], cache.enl2[file]];
      return verifyReading((n) => r[Math.min(n, r.length) - 1]).finalReading;
    };
    evaluate("현재 방식(원본→선명→확대)", current);
    for (const name of Object.keys(VARIANTS)) evaluate(`단독: ${name}`, (f) => cache[name][f]);
    const names = (xs: string[]) => (f: string) => xs.map((x) => cache[x][f]);
    const combos: Array<[string, string[], number]> = [
      ["다수결 3방법(2표↑ 신뢰)", ["orig", "sharp", "enl2"], 2],
      ["다수결 4방법(2표↑)", ["orig", "sharp", "enl2", "enl3"], 2],
      ["다수결 6방법(2표↑)", ["orig", "sharp", "enl2", "enl3", "sharpEnl2", "enl2Sharp"], 2],
    ];
    const results: Record<string, ReturnType<typeof evaluate>> = {};
    for (const [label, xs, votes] of combos) results[label] = evaluate(label, (f) => vote(names(xs)(f), f, votes, 100));
    expect(Object.keys(results).length).toBe(combos.length);
  }, 1_800_000);
});
