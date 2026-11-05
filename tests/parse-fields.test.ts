import { describe, expect, it } from "vitest";
import { enlarge, sharpen } from "@/lib/ocr/preprocess";
import { emptyReading, parseRegistryLines, type OcrLine } from "@/lib/ocr/parse-fields";
import { PNG } from "pngjs";

const line = (text: string, confidences: number[] | number = 96): OcrLine => ({
  words: text.split(" ").map((t, i) => ({ text: t, confidence: Array.isArray(confidences) ? (confidences[i] ?? 96) : confidences })),
});

const LINES: OcrLine[] = [
  line("등기사항전부증명서 (연습용 가짜)"),
  line("지번주소 : 별빛동 105"),
  line("[갑구] 소유권에 관한 사항"),
  line("1. 성명 : 임도담 주민등록번호 : 790628-2289636"),
  line("주소 : 가상시 샘플구 연습로 5길 50"),
  line("소유권이전일 : 2006-02-26 소유종료일 : 2010-02-26"),
  line("2. 성명 : 장이든 주민등록번호 : 620607-2634803"),
  line("주소 : 가상시 샘플구 연습로 3길 26"),
  line("소유권이전일 : 2010-02-26 소유종료일 : -"),
];

describe("글자 → 항목 나누기", () => {
  const r = parseRegistryLines(LINES, "fake-registry-17.png");
  it("지번주소와 소유자별 항목을 나눈다", () => {
    expect(r.lotAddress.value).toBe("별빛동 105");
    expect(r.owners.length).toBe(2);
    expect(r.owners[0].name.value).toBe("임도담");
    expect(r.owners[0].rrn.value).toBe("790628-2289636");
    expect(r.owners[0].address.value).toBe("가상시 샘플구 연습로 5길 50");
    expect(r.owners[0].ownershipDate.value).toBe("2006-02-26");
    expect(r.owners[0].ownershipEndDate.value).toBe("2010-02-26");
  });
  it("현재 소유자의 소유종료일 '-'는 빈 값으로 읽는다", () => {
    expect(r.owners[1].ownershipEndDate.value).toBeNull();
    expect(r.owners[1].ownershipEndDate.confidence).toBeGreaterThan(0);
  });
  it("항목 확신도는 그 항목 단어들 중 가장 낮은 값", () => {
    const low = parseRegistryLines(
      [line("지번주소 : 별빛동 105"), line("1. 성명 : 임도담 주민등록번호 : 790628-2289636", [99, 99, 99, 62, 99, 99, 88])],
      "x.png",
    );
    expect(low.owners[0].name.confidence).toBe(62); // "임도담" 단어
    expect(low.owners[0].rrn.confidence).toBe(88);
  });
  it("글자 사이에 공백이 끼어도 읽는다", () => {
    const r2 = parseRegistryLines([line("지 번 주 소 : 새솔동 1"), line("1. 성 명 : 김 가온 주민등록번호 : 800101-1234567")], "x.png");
    expect(r2.lotAddress.value).toBe("새솔동 1");
    expect(r2.owners[0].name.value).toBe("김가온"); // 이름 속 공백은 지운다
  });
  it("읽을 수 없는 그림은 확신도 0인 빈 결과 → 확인 필요", () => {
    const empty = parseRegistryLines([line("알 수 없는 글자 ###")], "bad.png");
    expect(empty).toEqual(emptyReading("bad.png"));
    expect(empty.lotAddress.confidence).toBe(0);
  });
});

describe("그림 가공 (회차마다 다른 방법)", () => {
  const img = new PNG({ width: 4, height: 2 });
  img.data.fill(200); // 연한 회색
  for (let i = 0; i < 4; i++) img.data[i] = 20; // 첫 점은 어두움
  const source = PNG.sync.write(img);
  it("흑백·선명: 어두운 점은 검정, 밝은 점은 흰색", () => {
    const out = PNG.sync.read(sharpen(source));
    expect([out.data[0], out.data[4]]).toEqual([0, 255]);
  });
  it("확대: 가로세로 2배", () => {
    const out = PNG.sync.read(enlarge(source, 2));
    expect([out.width, out.height]).toEqual([8, 4]);
  });
});
