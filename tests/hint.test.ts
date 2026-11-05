import { describe, expect, it } from "vitest";
import { conflictHint } from "../lib/hint";

describe("충돌 힌트", () => {
  it("날짜의 연도만 다르면 알려 준다", () => {
    expect(conflictHint("ownershipDate", "2014-10-27", "2013-10-27")).toContain("연도만");
  });
  it("연도는 같고 월·일이 다르면 알려 준다", () => {
    expect(conflictHint("ownershipDate", "2014-10-27", "2014-11-27")).toContain("월·일이 달라요");
  });
  it("한 글자만 다른 번호는 입력 실수 가능성을 알려 준다", () => {
    expect(conflictHint("rrn", "900815-2574849", "900815-2574848")).toContain("한 글자");
  });
  it("많이 다르거나 빈칸이면 힌트가 없다", () => {
    expect(conflictHint("address", "가상시 샘플구 시험로 4길 9", "가상시 샘플구 연습로 4길 9")).toBeNull();
    expect(conflictHint("rrn", null, "900815-2574848")).toBeNull();
  });
});
