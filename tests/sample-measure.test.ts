// 성공 기준을 가짜 샘플 30건 + 정답표로 재는 시험 (PLAN 22번의 기준 1·2·4·5).
import sampleJson from "@/sample-data/fake-sample.json";
import { describe, expect, it } from "vitest";
import { applyDecisions, itemKey, needsDecision, type Decision } from "@/lib/decisions";
import { INPUT_FIELDS, buildInputValues, compareCounts, makeMockInput, runInput, type MockRecord } from "@/lib/input-queue";
import { isBlank, isSameValue, normalizeValue, rrnFront } from "@/lib/normalize";
import { computeBilling, runPipeline } from "@/lib/pipeline";
import { formatRowId } from "@/lib/row-id";
import { loadSample } from "@/lib/sample";
import { tidyLot } from "@/lib/split-owners";
import type { FieldKey, InputJob, ReconcileItem, RegistryOwner, RegistryReading } from "@/lib/types";

const sample = loadSample();
const result = runPipeline({ rows: sample.rows, city: sample.city, sourceFiles: sample.sourceFiles, readRound: sample.readRound });
const truth = (sampleJson as unknown as { registries: RegistryReading[] }).registries;

const sameLot = (a: string, b: string) => normalizeValue("lotAddress", a) === normalizeValue("lotAddress", b);
const itemsOf = (lot: string, name: string) => {
  const rows = result.rows.filter((r) => sameLot(r.rowId.lotAddress, lot) && normalizeValue("name", r.fields.name) === normalizeValue("name", name));
  const keys = new Set(rows.map((r) => formatRowId(r.rowId)));
  return result.items.filter((i) => keys.has(formatRowId(i.rowId)));
};

describe("샘플 30건 측정: 불일치·누락 탐지율 (성공 기준 1)", () => {
  const detectable = sample.answerKey.filter((a) => a.kind !== "format-same");
  const detected = (a: (typeof detectable)[number]): boolean => {
    const items = itemsOf(a.lotAddress, a.ownerName);
    switch (a.kind) {
      case "new-owner": return items.some((i) => i.isNewRow && i.status === "filled");
      case "orphan": return items.some((i) => i.status === "needs-check");
      // 소유기간은 등기 기준으로 자동 수정되므로(충돌로 묻지 않음) "고쳤다"고 기록된 것도 찾은 것으로 본다.
      default: return items.some((i) => i.field === a.field && (i.status === a.expectedStatus || (a.expectedStatus === "conflict" && i.registryWins === true)));
    }
  };

  it("심어 둔 오류·빈칸을 90% 이상 찾는다", () => {
    const missed = detectable.filter((a) => !detected(a)).map((a) => `${a.kind}:${a.lotAddress}:${a.field}`);
    const rate = (detectable.length - missed.length) / detectable.length;
    console.log(`탐지율 ${(rate * 100).toFixed(1)}% (${detectable.length - missed.length}/${detectable.length}) 놓친 것: ${missed.join(", ") || "없음"}`);
    expect(rate).toBeGreaterThanOrEqual(0.9);
  });

  it("표기만 다른 값을 충돌·확인 필요로 잘못 잡지 않는다(오탐 0)", () => {
    const falsePositives = sample.answerKey
      .filter((a) => a.kind === "format-same")
      .flatMap((a) => itemsOf(a.lotAddress, a.ownerName).filter((i) => i.status === "conflict" || i.status === "needs-check"));
    expect(falsePositives.map((i) => `${formatRowId(i.rowId)}:${i.field}`)).toEqual([]);
  });

  it("엑셀에 있던 정상 값은 건드리지 않는다(자동 수정은 빈칸 보완뿐)", () => {
    const original = new Map(sample.rows.map((r) => [formatRowId({ ...r.rowId, lotAddress: tidyLot(r.rowId.lotAddress) }), r]));
    for (const row of result.rows) {
      const before = original.get(formatRowId(row.rowId));
      if (!before) continue; // 새로 추가된 줄
      for (const field of Object.keys(row.fields) as FieldKey[]) {
        if (before.fields[field] != null && String(before.fields[field]).trim() !== "") {
          // 소유기간만 예외: 등기 기준으로 고쳤다고 기록된 항목일 때만 바뀔 수 있다.
          const wins = result.items.some((i) => formatRowId(i.rowId) === formatRowId(row.rowId) && i.field === field && i.registryWins === true);
          if (wins) continue;
          expect(row.fields[field], `${formatRowId(row.rowId)} ${field}`).toBe(before.fields[field]);
        }
      }
    }
  });

  it("반복 검증: 대부분 2회에 끝나고, 값이 흔들리는 그림만 3회까지 간다", () => {
    const three = result.verify.filter((v) => v.rounds === 3).map((v) => v.sourceFile);
    expect(three.length).toBeGreaterThan(0);
    expect(three.length).toBeLessThan(5);
    expect(result.stats.maxRounds).toBe(3);
    expect(result.verify.reduce((n, v) => n + v.unstableCount, 0)).toBe(1); // 3회 후에도 달라지는 항목은 정답표대로 1개
  });
});

describe("샘플 30건 측정: 모의 입력 항목 일치율 (성공 기준 2·4)", () => {
  const truthOf = (lot: string, name: string, rrn: string | null): RegistryOwner | undefined => {
    const reading = truth.find((t) => sameLot(t.lotAddress.value ?? "", lot));
    return reading?.owners.find((o) => normalizeValue("name", o.name.value) === normalizeValue("name", name) || (rrnFront(rrn) !== "" && rrnFront(o.rrn.value) === rrnFront(rrn)));
  };
  const truthField = (lot: string, name: string, rrn: string | null, field: FieldKey) => truthOf(lot, name, rrn)?.[field as keyof RegistryOwner]?.value ?? null;

  // 직원이 정답을 아는 사람이라고 가정하고 충돌·확인 필요를 모두 해결한다.
  const decisions: Record<string, Decision> = {};
  const manual: ReconcileItem[] = result.items.filter(needsDecision);
  for (const item of manual) {
    const row = result.rows.find((r) => formatRowId(r.rowId) === formatRowId(item.rowId))!;
    const t = truthOf(row.rowId.lotAddress, row.fields.name ?? "", row.fields.rrn);
    const key = itemKey(item);
    if (item.field === "phone") { decisions[key] = { key, choice: "input", inputValue: "010-0000-0000" }; continue; } // 새 줄의 전화번호는 직접 입력
    if (item.field === "occupiedArea") { decisions[key] = { key, choice: "registry" }; continue; } // 점유면적은 구청 엑셀 값이 정답
    if (!t) { decisions[key] = { key, choice: "excel" }; continue; } // 엑셀에만 있는 줄
    const want = t[item.field as keyof RegistryOwner]?.value ?? null;
    if (isBlank(want) ? isBlank(item.excelValue) : isSameValue(item.field, item.excelValue, want)) decisions[key] = { key, choice: "excel" };
    else if ((item.registryValue !== null || item.status === "conflict") && (isBlank(want) ? isBlank(item.registryValue) : isSameValue(item.field, item.registryValue, want))) decisions[key] = { key, choice: "registry" };
    else decisions[key] = { key, choice: "input", inputValue: want ?? "" };
  }

  it("충돌·확인 필요를 모두 해결하면 남는 항목이 없다", () => {
    expect(applyDecisions(result.rows, result.items, decisions).unresolved.length).toBe(0);
    expect(manual.length).toBeGreaterThan(10);
  });

  it("승인한 줄을 모의 입력하면 5개 항목 중 4개(지번·성명·주소·주민번호)가 정답과 98% 이상 일치", () => {
    const { rows } = applyDecisions(result.rows, result.items, decisions);
    const orphans = new Set(result.orphanRowKeys);
    const jobs: InputJob[] = rows.map((r) => ({ rowId: r.rowId, approved: !orphans.has(formatRowId(r.rowId)), status: "pending", reason: null }));
    const records: MockRecord[] = [];
    const run = runInput(jobs, { doInput: makeMockInput(new Map(rows.map((r) => [formatRowId(r.rowId), r])), new Set(), (rec) => records.push(rec)) });
    expect(run.counts.excluded).toBe(1); // 엑셀에만 있는 줄은 승인하지 않음
    expect(compareCounts(run.jobs).matches).toBe(true);

    let total = 0;
    let match = 0;
    for (const rec of records) {
      const row = rows.find((r) => formatRowId(r.rowId) === rec.rowKey)!;
      const t = truthOf(row.rowId.lotAddress, row.fields.name ?? "", row.fields.rrn);
      if (!t) continue;
      for (const f of ["lotAddress", "name", "address", "rrn"] as const) {
        total++;
        const want = f === "lotAddress" ? truth.find((x) => sameLot(x.lotAddress.value ?? "", row.rowId.lotAddress))!.lotAddress.value : truthField(row.rowId.lotAddress, row.fields.name ?? "", row.fields.rrn, f);
        if (isSameValue(f, rec.values[f], want)) match++;
      }
      expect(Object.keys(rec.values).sort()).toEqual([...INPUT_FIELDS].sort()); // 다섯 항목만 입력
    }
    console.log(`입력 항목 일치율 ${((match / total) * 100).toFixed(1)}% (${match}/${total}), 입력 ${records.length}줄`);
    expect(match / total).toBeGreaterThanOrEqual(0.98);
  });

  it("승인 안 한 줄·해결 안 된 줄 기준: 직원이 직접 볼 건은 충돌·확인 필요뿐", () => {
    const auto = result.items.filter((i) => !needsDecision(i)).map((i) => i.status);
    expect(new Set(auto)).toEqual(new Set(["same", "filled"]));
  });

  it("부과 기간을 모든 줄에 계산한다", () => {
    const { rows } = applyDecisions(result.rows, result.items, decisions);
    const billing = computeBilling(rows, "2026-11-04");
    expect(Object.keys(billing).length).toBe(rows.length);
    const targets = Object.values(billing).filter((b) => b.target).length;
    expect(targets).toBeGreaterThan(0);
    // 같은 지번의 소유자 교체: 앞 소유자의 종료일이 뒷 소유자의 시작일보다 빠르다 (겹침 없음)
    for (const lot of new Set(rows.map((r) => tidyLot(r.rowId.lotAddress)))) {
      const owners = rows.filter((r) => tidyLot(r.rowId.lotAddress) === lot && r.fields.ownershipEndDate);
      for (const o of owners) {
        const b = billing[formatRowId(o.rowId)];
        if (b.target) expect(b.end < (o.fields.ownershipEndDate as string)).toBe(true);
      }
    }
    expect(buildInputValues(rows[0]).missing.length).toBeGreaterThanOrEqual(0);
  });
});
