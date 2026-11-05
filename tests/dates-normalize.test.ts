import { describe, expect, it } from "vitest";
import { addDays, compareDates, parseDate, todayKst } from "@/lib/dates";
import { isBlank, isSameValue, normalizeValue, rrnFront } from "@/lib/normalize";

describe("날짜 읽기", () => {
  it("여러 표기를 YYYY-MM-DD로 통일한다", () => {
    expect(parseDate("2020-01-02")).toBe("2020-01-02");
    expect(parseDate("2020. 1. 2.")).toBe("2020-01-02");
    expect(parseDate("2020.01.02")).toBe("2020-01-02");
    expect(parseDate("2020년 1월 2일")).toBe("2020-01-02");
    expect(parseDate("20200102")).toBe("2020-01-02");
  });
  it("없는 날짜나 빈 값은 null", () => {
    expect(parseDate("2020-02-30")).toBeNull();
    expect(parseDate("")).toBeNull();
    expect(parseDate(null)).toBeNull();
    expect(parseDate("글자")).toBeNull();
  });
  it("날짜 계산", () => {
    expect(addDays("2020-12-31", 1)).toBe("2021-01-01");
    expect(addDays("2020-03-01", -1)).toBe("2020-02-29");
    expect(compareDates("2020-01-01", "2020-01-02")).toBe(-1);
  });
  it("한국 시간 기준 오늘", () => {
    expect(todayKst(new Date("2026-11-04T16:00:00Z"))).toBe("2026-11-05"); // 한국은 UTC+9
  });
});

describe("같은 값 판단 (표기 차이는 같은 값)", () => {
  it("공백·쉼표·하이픈이 달라도 주소는 같다", () => {
    expect(isSameValue("address", "가상시 샘플구 연습로 3길 5", "가상시, 샘플구, 연습로, 3길, 5")).toBe(true);
    expect(isSameValue("lotAddress", "새솔동 27-1", "새솔동  27 - 1")).toBe(true);
  });
  it("주민번호·전화번호는 숫자만 비교", () => {
    expect(isSameValue("rrn", "800101-1234567", "8001011234567")).toBe(true);
    expect(isSameValue("phone", "010-1234-5678", "01012345678")).toBe(true);
  });
  it("이름은 공백만 무시", () => {
    expect(isSameValue("name", "김가온", "김 가온")).toBe(true);
    expect(isSameValue("name", "김가온", "김가을")).toBe(false);
  });
  it("날짜는 표기가 달라도 같다", () => {
    expect(isSameValue("ownershipDate", "2015. 3. 2.", "2015-03-02")).toBe(true);
    expect(isSameValue("ownershipDate", "2015-03-02", "2015-03-03")).toBe(false);
  });
  it("값이 다르면 다르다", () => {
    expect(isSameValue("rrn", "800101-1234567", "800101-1234568")).toBe(false);
  });
  it("빈칸 판단과 주민번호 앞자리", () => {
    expect(isBlank("  ")).toBe(true);
    expect(isBlank(null)).toBe(true);
    expect(isBlank("0")).toBe(false);
    expect(rrnFront("800101-1234567")).toBe("800101");
    expect(rrnFront("123")).toBe("");
    expect(normalizeValue("name", null)).toBe("");
  });
  it("점유면적은 숫자로 보고, ㎡·쉼표·끝자리 0 차이는 같은 값", () => {
    expect(isSameValue("occupiedArea", "45.30", "45.3㎡")).toBe(true);
    expect(isSameValue("occupiedArea", "1,045.3 ㎡", "1045.3")).toBe(true);
    expect(isSameValue("occupiedArea", "45.3", "45.4")).toBe(false);
    expect(isSameValue("occupiedArea", "", null)).toBe(true);
  });
});
