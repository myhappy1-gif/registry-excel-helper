// AI가 돌려준 글자를 앱 모양으로 바꾸는 규칙 시험 (외부 호출 없음).
import { describe, expect, it } from "vitest";
import { readRegistryRoundsLlm, toReading } from "../lib/llm/read-llm";

const owner = (o: Partial<Record<"name" | "rrn" | "address" | "ownershipDate" | "ownershipEndDate", string | null>> = {}) => ({
  name: "김가온", rrn: "800101-1234567", address: "가상시 샘플구 연습로 1길 1", ownershipDate: "2015-03-02", ownershipEndDate: null, ...o,
});

describe("AI 읽기 결과 바꾸기·모양 검사", () => {
  it("모양이 맞는 값은 믿을 만한 값(확신도 90 이상)이 되고, 현재 소유자의 소유종료일은 비어 있다", () => {
    const r = toReading({ lotAddress: "하늘동 4", owners: [owner()] }, "fake-registry-01.pdf");
    expect(r.lotAddress.value).toBe("하늘동 4");
    expect(r.lotAddress.confidence).toBeGreaterThanOrEqual(90);
    expect(r.owners[0].name.confidence).toBeGreaterThanOrEqual(90);
    expect(r.owners[0].ownershipEndDate).toEqual({ value: null, confidence: expect.any(Number) });
    expect(r.owners[0].ownershipEndDate.confidence).toBeGreaterThanOrEqual(90);
  });
  it("없는 날짜·이상한 이름·월이 13인 주민번호는 확인 필요(확신도 0)로 보낸다", () => {
    const r = toReading({ lotAddress: "하늘동 4", owners: [owner({ name: "K1m", rrn: "801301-1234567", ownershipDate: "2015-02-30" })] }, "x.pdf");
    expect(r.owners[0].name.confidence).toBe(0);
    expect(r.owners[0].rrn.confidence).toBe(0);
    expect(r.owners[0].ownershipDate.confidence).toBe(0);
  });
  it("뒷자리가 가려진 주민번호는 그대로 둔다", () => {
    const r = toReading({ lotAddress: "하늘동 4", owners: [owner({ rrn: "800101-*******" })] }, "x.pdf");
    expect(r.owners[0].rrn.value).toBe("800101-*******");
    expect(r.owners[0].rrn.confidence).toBeGreaterThanOrEqual(90);
  });
  it("소유 순서가 거꾸로면(접수일이 앞 소유자보다 이르면) 믿지 않는다", () => {
    const r = toReading({ lotAddress: "하늘동 4", owners: [owner({ ownershipDate: "2020-01-01" }), owner({ name: "이나래", ownershipDate: "2010-01-01" })] }, "x.pdf");
    expect(r.owners[1].ownershipDate.confidence).toBe(0);
  });
  it("파일 이름에 국유지 번지 규칙이 있으면 그 번지를 쓴다", () => {
    const r = toReading({ lotAddress: "엉뚱동 9", owners: [] }, "산12-3_등기.pdf");
    expect(r.lotAddress.value).toBe("산12-3");
  });
  it("키가 없으면 AI로 읽을 수 없다(외부로 아무것도 보내지 않는다)", async () => {
    const saved = process.env.OPENAI_API_KEY;
    delete process.env.OPENAI_API_KEY;
    await expect(readRegistryRoundsLlm("nope.pdf", "fake-registry-01.pdf")).rejects.toThrow();
    if (saved !== undefined) process.env.OPENAI_API_KEY = saved;
  });
  it("가짜 샘플(fake-)이 아닌 파일은 외부로 보내지 않고 거부한다", async () => {
    const savedKey = process.env.OPENAI_API_KEY;
    const savedAllow = process.env.LLM_ALLOW_REAL;
    process.env.OPENAI_API_KEY = "test-not-a-real-key";
    delete process.env.LLM_ALLOW_REAL;
    await expect(readRegistryRoundsLlm("nope.pdf", "실제등기.pdf")).rejects.toThrow(/fake-/);
    if (savedKey === undefined) delete process.env.OPENAI_API_KEY; else process.env.OPENAI_API_KEY = savedKey;
    if (savedAllow !== undefined) process.env.LLM_ALLOW_REAL = savedAllow;
  });
});
