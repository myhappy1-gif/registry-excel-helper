// 글자가 들어 있는 가짜 등기 PDF 100건을 읽어 정답표와 비교하고, 대조 결과(확인 필요 비율)를 잰다. (PLAN 26~29번)
import sampleJson from "@/sample-data/fake-sample.json";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { isSameValue } from "@/lib/normalize";
import { lotFromFileName, parseRegistryPdf } from "@/lib/pdf/parse-registry";
import { readRegistryPdf } from "@/lib/pdf/read-pdf";
import { runPipeline } from "@/lib/pipeline";
import { loadSample } from "@/lib/sample";
import type { PdfPage } from "@/lib/pdf/extract";
import type { RegistryReading } from "@/lib/types";

const truth = (sampleJson as unknown as { registries: RegistryReading[] }).registries;
const pdfName = (png: string) => png.replace(/\.png$/i, ".pdf");
const PDF_DIR = path.resolve("sample-data/pdfs");

describe("가짜 등기 PDF 100건 읽기", () => {
  const readings = new Map<string, RegistryReading>();

  it("정답표와 모든 항목이 맞고, 모든 값이 믿을 수 있는 값(확신도 100)으로 읽힌다", async () => {
    let total = 0;
    let match = 0;
    let low = 0;
    for (const t of truth) {
      const file = pdfName(t.sourceFile);
      const { reading, hasText, issues } = await readRegistryPdf(path.join(PDF_DIR, file), file);
      readings.set(file, reading);
      expect(hasText, file).toBe(true);
      expect(issues, file).toEqual([]);
      const cmp = (field: Parameters<typeof isSameValue>[0], a: { value: string | null; confidence: number } | undefined, want: string | null) => {
        total++;
        const same = isSameValue(field, a?.value ?? null, want);
        if (same) match++;
        else console.log(`  불일치 ${file} ${field}`);
        if ((a?.confidence ?? 0) < 90) low++;
      };
      cmp("lotAddress", reading.lotAddress, t.lotAddress.value);
      expect(reading.owners.length, file).toBe(t.owners.length);
      t.owners.forEach((o, i) => {
        const g = reading.owners[i];
        cmp("name", g?.name, o.name.value);
        cmp("rrn", g?.rrn, o.rrn.value);
        cmp("address", g?.address, o.address.value);
        cmp("ownershipDate", g?.ownershipDate, o.ownershipDate.value);
        cmp("ownershipEndDate", g?.ownershipEndDate, o.ownershipEndDate.value);
      });
    }
    console.log(`PDF 글자 읽기 항목 일치율 ${((match / total) * 100).toFixed(1)}% (${match}/${total}), 확신도 90 미만 ${low}개`);
    expect(match).toBe(total);
    expect(low).toBe(0);
  });

  it("엑셀과 대조하면 직원이 볼 '확인 필요'가 크게 줄어든다 (PNG 글자 읽기는 28%)", () => {
    const sample = loadSample();
    const files = truth.map((t) => pdfName(t.sourceFile));
    const base = runPipeline({ rows: sample.rows, city: sample.city, sourceFiles: sample.sourceFiles, readRound: sample.readRound });
    const res = runPipeline({ rows: sample.rows, city: sample.city, sourceFiles: files, readRound: (f) => structuredClone(readings.get(f)!) });
    const c = res.stats.counts;
    const pct = (c["needs-check"] / res.items.length) * 100;
    console.log(`[정답 읽기 기준] ${JSON.stringify(base.stats.counts)} / [PDF 읽기] ${JSON.stringify(c)} 확인 필요 ${pct.toFixed(1)}% (${res.items.length}건)`);
    expect(pct).toBeLessThan(15);
    // 모든 값이 믿을 수 있는 값으로 읽히므로 정답 읽기 때보다 놓치는 충돌이 없어야 한다.
    expect(c.conflict).toBeGreaterThanOrEqual(base.stats.counts.conflict);
  });
});

describe("등기 PDF 해석 규칙 (글자 조각을 직접 넣어 시험)", () => {
  // 갑구 표를 흉내 낸 글자 조각들. 칸 머리글: 순위번호(x=30) 등기목적(99) 접수(203) 등기원인(272) 권리자(413)
  const it_ = (str: string, x: number, y: number, width = str.length * 9) => ({ str, x, y, size: 10, width });
  const header = [
    it_("【", 50, 600), it_("갑", 78, 600), it_("구", 134, 600), it_("】", 162, 600),
    it_("순위번호", 30, 570, 40), it_("등 기 목 적", 99, 570, 55), it_("접 수", 203, 570, 30), it_("등 기 원 인", 272, 570, 55), it_("권리자 및 기타사항", 413, 570, 90),
  ];
  const top = [it_("[건물] 가상도 가상시 하늘동 4", 24, 760)];
  const page = (rows: ReturnType<typeof it_>[]): PdfPage[] => [[...top, ...header, ...rows]];

  it("보존 → 이전: 앞 소유자의 소유종료일은 다음 등기의 접수일", () => {
    const pages = page([
      it_("1", 47, 540), it_("소유권보존", 80, 540), it_("2010년1월5일", 182, 540), it_("소유자", 346, 540), it_("김가온", 386, 540), it_("800101-*******", 440, 540),
      it_("가상시 샘플구 연습로 1길 1", 366, 526),
      it_("2", 47, 490), it_("소유권이전", 80, 490), it_("2020년3월4일", 182, 490), it_("2020년1월2일", 264, 490), it_("소유자", 346, 490), it_("이하늘", 386, 490), it_("900202-*******", 440, 490),
      it_("가상시 샘플구 연습로 2길 2", 366, 476), it_("거래가액 금50,000,000원", 346, 462),
    ]);
    const { reading } = parseRegistryPdf(pages, "t.pdf");
    expect(reading.lotAddress.value).toBe("하늘동 4");
    expect(reading.owners.map((o) => [o.name.value, o.ownershipDate.value, o.ownershipEndDate.value])).toEqual([
      ["김가온", "2010-01-05", "2020-03-04"],
      ["이하늘", "2020-03-04", null],
    ]);
    expect(reading.owners[1].address.value).toBe("가상시 샘플구 연습로 2길 2"); // 거래가액 줄은 주소에 섞이지 않는다
  });

  it("가등기·말소 등기와 을구의 이름은 소유자로 치지 않는다", () => {
    const pages = page([
      it_("1", 47, 540), it_("소유권보존", 80, 540), it_("2010년1월5일", 182, 540), it_("소유자", 346, 540), it_("김가온", 386, 540), it_("800101-*******", 440, 540), it_("가상시 연습로 1", 366, 526),
      it_("2", 47, 490), it_("소유권이전청구권가등기", 80, 490), it_("2012년2월2일", 182, 490), it_("가등기권자", 346, 490), it_("박다솜", 400, 490), it_("700303-*******", 450, 490), it_("가상시 연습로 3", 366, 476),
      it_("3", 47, 440), it_("2번가등기말소", 80, 440), it_("2013년2월2일", 182, 440),
      it_("【", 50, 400), it_("을", 78, 400), it_("구", 134, 400), it_("】", 162, 400),
      it_("채무자", 346, 380), it_("최보람", 400, 380), it_("근저당권자", 346, 360), it_("주식회사샘플은행", 420, 360), it_("110111-0000000", 500, 360),
    ]);
    const { reading } = parseRegistryPdf(pages, "t.pdf");
    expect(reading.owners.map((o) => o.name.value)).toEqual(["김가온"]);
    expect(reading.owners[0].ownershipEndDate.value).toBeNull();
  });

  it("공유자 여럿은 같은 날 시작하고, 전부 이전되면 모두 같은 날 끝난다", () => {
    const pages = page([
      it_("1", 47, 540), it_("소유권보존", 80, 540), it_("2010년1월5일", 182, 540), it_("공유자", 346, 540),
      it_("지분 2분의 1", 356, 526), it_("김가온", 356, 512), it_("800101-*******", 410, 512), it_("가상시 연습로 1", 366, 498),
      it_("지분 2분의 1", 356, 484), it_("이하늘", 356, 470), it_("900202-*******", 410, 470), it_("가상시 연습로 2", 366, 456),
      it_("2", 47, 420), it_("공유자전원지분전부이전", 80, 420), it_("2020년3월4일", 182, 420), it_("소유자", 346, 420), it_("박다솜", 400, 420), it_("700303-*******", 450, 420), it_("가상시 연습로 3", 366, 406),
    ]);
    const { reading } = parseRegistryPdf(pages, "t.pdf");
    expect(reading.owners.map((o) => [o.name.value, o.ownershipDate.value, o.ownershipEndDate.value])).toEqual([
      ["김가온", "2010-01-05", "2020-03-04"],
      ["이하늘", "2010-01-05", "2020-03-04"],
      ["박다솜", "2020-03-04", null],
    ]);
  });

  it("해석하지 못한 소유권 등기가 있으면 지번을 불확실로 표시한다", () => {
    const pages = page([it_("1", 47, 540), it_("소유권보존", 80, 540), it_("2010년1월5일", 182, 540)]); // 권리자 칸이 비어 있음
    const { reading, issues } = parseRegistryPdf(pages, "t.pdf");
    expect(reading.lotAddress.confidence).toBe(0);
    expect(issues.length).toBeGreaterThan(0);
  });

  it("글자가 거의 없는 PDF(스캔한 그림)는 읽을 수 없다고 알린다", () => {
    const { hasText, reading, issues } = parseRegistryPdf([[it_("열", 10, 10)]], "scan.pdf");
    expect(hasText).toBe(false);
    expect(reading.owners).toEqual([]);
    expect(issues[0]).toContain("글자를 찾지 못했어요");
  });

  it("주민번호 앞자리가 날짜로 말이 안 되면 확인 필요로 둔다", () => {
    const pages = page([
      it_("1", 47, 540), it_("소유권보존", 80, 540), it_("2010년1월5일", 182, 540), it_("소유자", 346, 540), it_("김가온", 386, 540), it_("801399-*******", 440, 540), it_("가상시 연습로 1", 366, 526),
    ]);
    expect(parseRegistryPdf(pages, "t.pdf").reading.owners[0].rrn.confidence).toBe(0);
  });

  it("파일 이름 앞의 국유지 번지 규칙", () => {
    expect(lotFromFileName("산12-3_등기.pdf")).toBe("산12-3");
    expect(lotFromFileName("하늘동 4_등기.pdf")).toBe("하늘동 4");
    expect(lotFromFileName("fake-registry-01.pdf")).toBeNull();
  });
});
