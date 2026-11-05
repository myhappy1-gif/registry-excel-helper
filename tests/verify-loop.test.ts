import { describe, expect, it } from "vitest";
import { ROUND_METHODS, verifyReading } from "@/lib/verify-loop";
import type { ReadMethod, RegistryReading } from "@/lib/types";
import { owner, reading, rv } from "./helpers";

const withAddress = (addr: string, conf = 99): RegistryReading =>
  reading("새솔동 1", [owner({ name: "김가온", address: rv(addr, conf) })]);

describe("반복 검증", () => {
  it("2회째에 같으면 거기서 멈춘다", () => {
    const calls: number[] = [];
    const out = verifyReading((round) => (calls.push(round), withAddress("가")));
    expect(out.rounds).toBe(2);
    expect(calls).toEqual([1, 2]);
    expect(out.unstablePaths).toEqual([]);
  });

  it("2회째에 값이 다르면 3회째까지 가고, 3회째가 2회째와 같으면 안정으로 본다", () => {
    const values = ["가", "나", "나"];
    const out = verifyReading((round) => withAddress(values[round - 1]));
    expect(out.rounds).toBe(3);
    expect(out.unstablePaths).toEqual([]);
    expect(out.finalReading.owners[0].address.confidence).toBe(99);
  });

  it("3회 후에도 달라지면 그 항목은 확신도 0 → 확인 필요", () => {
    const values = ["가", "나", "다"];
    const out = verifyReading((round) => withAddress(values[round - 1]));
    expect(out.rounds).toBe(3);
    expect(out.unstablePaths).toEqual(["owner0.address"]);
    expect(out.finalReading.owners[0].address.confidence).toBe(0);
    expect(out.finalReading.owners[0].name.confidence).toBe(99); // 다른 항목은 그대로
  });

  it("3회를 넘겨서 돌리지 않는다", () => {
    let count = 0;
    verifyReading((round) => (count++, withAddress(String(round))));
    expect(count).toBe(3);
  });

  it("회차마다 읽는 방법이 바뀐다 (원본 → 흑백·선명 → 확대)", () => {
    const methods: ReadMethod[] = [];
    verifyReading((round, method) => (methods.push(method), withAddress(String(round))));
    expect(methods).toEqual([...ROUND_METHODS]);
  });

  it("표기만 다른 값(공백)은 같은 값으로 봐서 2회에 끝난다", () => {
    const values = ["가상시 샘플구", "가상시  샘플구"];
    expect(verifyReading((round) => withAddress(values[round - 1])).rounds).toBe(2);
  });
});
