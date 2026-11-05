import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import ExcelJS from "exceljs";
import { afterEach, describe, expect, it } from "vitest";
import { UserError, toErrorResponse } from "@/lib/errors";
import { buildReportWorkbook, buildRowsWorkbook, readExcelRows, readBillingHistory, sanitizeCell, saveNewWorkbook } from "@/lib/excel-io";
import { demoMaskName, maskAddress, maskName, maskPhone, maskRrn, maskValue } from "@/lib/mask";
import { isSameOrigin } from "@/lib/origin-check";
import { buildReportSummary } from "@/lib/report";
import { assertWritable, isDeployed, ocrMode } from "@/lib/runtime-mode";
import { pickAllowed, resolveInside } from "@/lib/safe-path";
import { row } from "./helpers";

describe("파일 이름 검사 (경로 탈출 방지)", () => {
  const base = path.resolve("sample-data");
  it("목록에 있는 파일 이름만 받는다", () => {
    expect(pickAllowed("fake-sample.json", ["fake-sample.json"])).toBe("fake-sample.json");
    expect(() => pickAllowed("../.env", ["fake-sample.json"])).toThrow(UserError);
    expect(() => pickAllowed("other.json", ["fake-sample.json"])).toThrow(UserError);
  });
  it("../ 나 경로가 든 이름은 폴더 안이어도 거부한다", () => {
    for (const bad of ["../.env", "..\\.env", "a/b.txt", "a\\b.txt", "..", "", "C:\\Windows\\win.ini", "/etc/passwd", "x/../../y"]) {
      expect(() => resolveInside(base, bad), bad).toThrow(UserError);
    }
  });
  it("정상 이름은 폴더 안 경로가 된다", () => {
    expect(resolveInside(base, "fake-existing.xlsx")).toBe(path.join(base, "fake-existing.xlsx"));
  });
});

describe("요청 출처(Origin) 검사", () => {
  const req = (headers: Record<string, string>) => new Request("http://localhost:3000/api/x", { method: "POST", headers });
  it("같은 사이트에서 온 요청만 통과", () => {
    expect(isSameOrigin(req({ origin: "http://localhost:3000", host: "localhost:3000" }))).toBe(true);
    expect(isSameOrigin(req({ origin: "http://evil.example", host: "localhost:3000" }))).toBe(false);
    expect(isSameOrigin(req({ host: "localhost:3000" }))).toBe(false);
    expect(isSameOrigin(req({ origin: "not a url", host: "localhost:3000" }))).toBe(false);
  });
});

describe("배포판 보호", () => {
  const withEnv = (env: Record<string, string | undefined>, fn: () => void) => {
    const old = { ...process.env };
    Object.assign(process.env, env);
    for (const [k, v] of Object.entries(env)) if (v === undefined) delete process.env[k];
    try { fn(); } finally { process.env = old; }
  };
  it("배포 환경에서는 쓰기를 거부하고, 글자 읽기는 샘플 모드로 고정", () => {
    withEnv({ VERCEL: "1", OCR_MODE: "local" }, () => {
      expect(isDeployed()).toBe(true);
      expect(ocrMode()).toBe("sample");
      expect(() => assertWritable()).toThrow(UserError);
    });
  });
  it("OCR_MODE가 없으면 샘플 모드가 기본", () => {
    withEnv({ VERCEL: undefined, DEMO_ONLY: undefined, OCR_MODE: undefined }, () => {
      expect(ocrMode()).toBe("sample");
      expect(() => assertWritable()).not.toThrow();
    });
  });
  it("알 수 없는 오류는 자세한 내용을 숨긴다", () => {
    const res = toErrorResponse(new Error("C:\\secret\\path failed"));
    expect(res.status).toBe(500);
    expect(JSON.stringify(res.body)).not.toContain("secret");
  });
});

describe("개인정보 가리기", () => {
  it("이름·전화·주민번호·주소를 가린다", () => {
    expect(maskName("김가온")).toBe("김○○");
    expect(demoMaskName("김소담")).toBe("김소*"); // 시연판: 마지막 글자만
    expect(demoMaskName("남궁 민수")).toBe("남궁민*");
    expect(maskPhone("010-1234-5678")).toBe("010-****-5678");
    expect(maskRrn("800101-1234567")).toBe("800101-*******");
    expect(maskAddress("가상시 샘플구 연습로 3길 5")).toBe("가상시 ***");
    expect(maskValue("ownershipDate", "2020-01-02")).toBe("2020-01-02"); // 날짜는 개인정보가 아님
  });
  it("리포트 요약에는 개인 값이 들어가지 않는다", () => {
    const summary = buildReportSummary([], [], [{ rowId: { lotAddress: "가동 1", ownerIndex: 1 }, field: "phone", reason: "비었어요" }]);
    expect(JSON.stringify(summary)).not.toMatch(/\d{6}-\d{7}|010-\d{4}-\d{4}/);
    expect(summary.unprocessed[0]).toEqual({ rowKey: "가동 1 (1)", field: "전화번호", reason: "비었어요" });
  });
});

describe("엑셀 읽기·저장", () => {
  let dir = "";
  afterEach(async () => { if (dir) await rm(dir, { recursive: true, force: true }); dir = ""; });

  it("수식 시작 글자 앞에는 '를 붙인다", () => {
    expect(sanitizeCell("=HYPERLINK(\"x\")")).toBe("'=HYPERLINK(\"x\")");
    expect(sanitizeCell("+1")).toBe("'+1");
    expect(sanitizeCell("-1")).toBe("'-1");
    expect(sanitizeCell("@a")).toBe("'@a");
    expect(sanitizeCell("2020-01-02")).toBe("2020-01-02");
    expect(sanitizeCell(null)).toBeNull();
  });

  it("샘플 엑셀을 읽는다 (같은 지번 여러 줄은 소유자 순번이 붙는다)", async () => {
    const rows = await readExcelRows(path.resolve("sample-data/fake-existing.xlsx"));
    expect(rows.length).toBe(174);
    const byLot = rows.filter((r) => r.rowId.lotAddress === rows[0].rowId.lotAddress);
    expect(byLot.map((r) => r.rowId.ownerIndex)).toEqual(byLot.map((_, i) => i + 1));
    const city = await readBillingHistory(path.resolve("sample-data/fake-city-billing.xlsx"));
    expect(city.length).toBe(90);
  });

  it("수정본을 새 파일로 저장하고, 원본과 같은 경로·밖의 경로·이미 있는 이름은 거부한다", async () => {
    dir = await mkdtemp(path.join(tmpdir(), "my-app-test-"));
    const buf = await buildRowsWorkbook([row("가동 1", 1, { name: "=SUM(A1)", phone: "010-1111-2222" })]);
    const saved = await saveNewWorkbook(buf, dir, "수정본.xlsx");
    expect(path.dirname(saved)).toBe(dir);
    await expect(saveNewWorkbook(buf, dir, "수정본.xlsx")).rejects.toThrow(); // 덮어쓰기 거부
    await expect(saveNewWorkbook(buf, dir, "x.xlsx", path.join(dir, "x.xlsx"))).rejects.toMatchObject({ code: "overwrite-original" });
    await expect(saveNewWorkbook(buf, dir, "../밖.xlsx")).rejects.toThrow(UserError);
    await expect(saveNewWorkbook(buf, dir, "a.txt")).rejects.toThrow(UserError);
    // 저장된 내용에서 수식 글자가 글자로 남았는지
    const back = await readExcelRows(await readFile(saved));
    expect(back[0].fields.name).toBe("'=SUM(A1)");
  });

  it("필요한 열이 없으면 쉬운 안내를 준다", async () => {
    const wb = new ExcelJS.Workbook();
    wb.addWorksheet("s").addRow(["지번주소", "성명"]);
    const buffer = Buffer.from(await wb.xlsx.writeBuffer());
    await expect(readExcelRows(buffer)).rejects.toMatchObject({ code: "missing-column", message: expect.stringContaining("열이 없어요") });
  });

  it("리포트 엑셀에는 건수와 미처리 목록만 들어 있다", async () => {
    const summary = buildReportSummary([], [], []);
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load((await buildReportWorkbook(summary)) as unknown as ArrayBuffer);
    expect(wb.worksheets.map((w) => w.name)).toEqual(["결과 요약", "미처리 목록"]);
    expect(wb.worksheets[0].rowCount).toBe(8); // 머리글 + 7개 구분
  });
});
