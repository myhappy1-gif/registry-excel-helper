// 서버 입구(app/api/*)의 보안·안전 동작 시험: 출처 검사, 잘못된 값 거부, 배포판에서 파일을 쓰지 않는 것, 승인 안 한 줄 입력 거부.
import { existsSync, mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { POST as clearRoute } from "@/app/api/clear/route";
import { POST as exportRoute } from "@/app/api/export/route";
import { GET as filesRoute } from "@/app/api/files/route";
import { POST as inputRoute } from "@/app/api/input/route";
import { POST as reportRoute } from "@/app/api/report/route";
import { POST as verifyRoute } from "@/app/api/verify/route";
import type { InputJob } from "@/lib/types";
import { row } from "./helpers";

const HOST = "localhost:3000";
const post = (body: unknown, headers: Record<string, string> = { origin: `http://${HOST}`, host: HOST }) =>
  new Request(`http://${HOST}/api/x`, { method: "POST", headers: { "content-type": "application/json", ...headers }, body: typeof body === "string" ? body : JSON.stringify(body) });

let tmp = "";
const saved = { ...process.env };
beforeEach(() => {
  tmp = mkdtempSync(path.join(tmpdir(), "my-app-api-"));
  process.env.WORK_DIR = tmp;
  delete process.env.VERCEL;
  delete process.env.DEMO_ONLY;
  delete process.env.OCR_MODE;
});
afterEach(() => {
  process.env = { ...saved };
  rmSync(tmp, { recursive: true, force: true });
});

const goodRow = row("가동 1", 1, { name: "김가온", phone: "010-1111-2222", address: "가상시 샘플구 연습로 1길 1", rrn: "800101-1234567" });
const job = (approved: boolean): InputJob => ({ rowId: goodRow.rowId, approved, status: "pending", reason: null });

describe("서버 입구 공통 보호", () => {
  it("다른 사이트에서 온 요청이나 출처가 없는 요청은 거부한다", async () => {
    const cases: Array<Record<string, string>> = [{ origin: "http://evil.example", host: HOST }, { host: HOST }];
    for (const headers of cases) {
      const res = await verifyRoute(post({}, headers));
      expect(res.status).toBe(403);
    }
  });
  it("깨진 JSON이나 모양이 틀린 값은 쉬운 안내와 함께 400으로 거부한다", async () => {
    expect((await inputRoute(post("{not json"))).status).toBe(400);
    const bad = await inputRoute(post({ rows: "x", jobs: [] }));
    expect(bad.status).toBe(400);
    expect((await bad.json()).error).toContain("올바르지 않아요");
    expect((await inputRoute(post({ rows: [goodRow], jobs: [{ rowId: { lotAddress: "가", ownerIndex: 0 }, approved: true, status: "pending", reason: null }] }))).status).toBe(400);
    expect((await inputRoute(post({ rows: [], jobs: [{ ...job(true), status: "hacked" }] }))).status).toBe(400);
    expect((await reportRoute(post({ items: [{ status: "weird" }], jobs: [], unprocessed: [] }))).status).toBe(400);
  });
  it("너무 긴 글자는 거부한다", async () => {
    const huge = { ...goodRow, fields: { ...goodRow.fields, name: "가".repeat(5000) } };
    expect((await inputRoute(post({ rows: [huge], jobs: [job(true)] }))).status).toBe(400);
  });
  it("오류 응답에 내부 경로 같은 정보가 없다", async () => {
    const res = await inputRoute(post("{not json"));
    expect(JSON.stringify(await res.json())).not.toMatch(/[A-Za-z]:\\|node_modules|at .*\.ts/);
  });
});

describe("검증·입력 흐름", () => {
  it("검증은 샘플 100장을 읽고 대조 결과를 돌려준다 (배포 환경이 아니어도 기본은 샘플 모드)", async () => {
    const res = await verifyRoute(post({}));
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.mode).toBe("sample");
    expect(data.stats.registries).toBe(100);
    expect(data.stats.counts.conflict).toBeGreaterThan(0);
    expect(data.today).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
  it("파일 목록은 서버가 실제 폴더를 읽어 만든다", async () => {
    const res = await filesRoute(new Request(`http://${HOST}/api/files`, { headers: { host: HOST } }));
    const data = await res.json();
    expect(data.existing).toEqual(["fake-existing.xlsx"]);
    expect(data.city).toEqual(["fake-city-billing.xlsx"]);
    expect(data.imageCount).toBe(100);
    expect(data.pdfCount).toBe(100);
  });
  it("승인하지 않은 줄은 입력하지 않는다", async () => {
    const res = await inputRoute(post({ rows: [goodRow], jobs: [job(false)] }));
    const data = await res.json();
    expect(data.counts).toMatchObject({ done: 0, excluded: 1 });
    expect(data.jobs[0].status).toBe("excluded");
  });
  it("승인한 줄만 입력하고, 이 컴퓨터에서는 상태와 입력 기록을 작업 폴더에 저장한다", async () => {
    const data = await (await inputRoute(post({ rows: [goodRow], jobs: [job(true)] }))).json();
    expect(data.counts.done).toBe(1);
    expect(data.saved).toBe(true);
    expect(readdirSync(tmp).sort()).toEqual(["mock-input.json", "state.json"]);
    // 끝내기: 자료 지우기
    expect((await (await clearRoute(post({}))).json()).removed.sort()).toEqual(["mock-input.json", "state.json"]);
    expect(readdirSync(tmp)).toEqual([]);
  });
  it("이미 입력한 줄은 다시 입력하지 않는다 (이어서 처리)", async () => {
    const first = await (await inputRoute(post({ rows: [goodRow], jobs: [job(true)] }))).json();
    const again = await (await inputRoute(post({ rows: [goodRow], jobs: first.jobs }))).json();
    expect(again.counts).toMatchObject({ done: 0, skipped: 1 });
  });
  it("시험용 실패 설정: 연속 5건 실패하면 멈춘다", async () => {
    const rows = Array.from({ length: 8 }, (_, i) => row(`나동 ${i + 1}`, 1, goodRow.fields));
    const jobs: InputJob[] = rows.map((r) => ({ rowId: r.rowId, approved: true, status: "pending", reason: null }));
    const data = await (await inputRoute(post({ rows, jobs, failKeys: rows.map((r) => `${r.rowId.lotAddress} (1)`) }))).json();
    expect(data.stoppedEarly).toBe(true);
    expect(data.counts).toMatchObject({ failed: 5, notAttempted: 3 });
  });
});

describe("배포판(공개 시연) 보호", () => {
  beforeEach(() => { process.env.VERCEL = "1"; process.env.OCR_MODE = "local"; });

  it("파일을 저장하지 않고, 글자 읽기 방식은 샘플로 고정된다", async () => {
    const data = await (await inputRoute(post({ rows: [goodRow], jobs: [job(true)] }))).json();
    expect(data.counts.done).toBe(1);
    expect(data.saved).toBe(false);
    expect(readdirSync(tmp)).toEqual([]);
    expect((await (await verifyRoute(post({}))).json()).mode).toBe("sample");
  });
  it("화면으로 나가는 결과에서 주민번호는 생년월일만, 이름은 마지막 글자가 가려진다", async () => {
    const data = await (await verifyRoute(post({}))).json();
    const text = JSON.stringify(data);
    expect(text).not.toMatch(/\d{6}-\d{7}/); // 13자리 주민번호가 없다
    expect(text).toMatch(/\d{6}-\*{7}/);
    const names = data.rows.map((r: { fields: { name: string | null } }) => r.fields.name).filter(Boolean) as string[];
    expect(names.length).toBeGreaterThan(0);
    expect(names.every((n) => n.endsWith("*"))).toBe(true);
    expect(data.items.every((i: { field: string; excelValue: string | null }) => i.field !== "name" || !i.excelValue || i.excelValue.endsWith("*"))).toBe(true);
  });
  it("이 컴퓨터에서(배포판이 아닐 때)는 가리지 않는다", async () => {
    delete process.env.VERCEL;
    const text = JSON.stringify(await (await verifyRoute(post({}))).json());
    expect(text).toMatch(/\d{6}-\d{7}/);
  });
  it("자료 지우기는 거부하고, 목록은 가짜 이름만 보여준다", async () => {
    expect((await clearRoute(post({}))).status).toBe(403);
    const files = await (await filesRoute(new Request(`http://${HOST}/api/files`, { headers: { host: HOST } }))).json();
    expect(files.deployed).toBe(true);
  });
  it("수정본 내려받기는 되지만 서버 폴더에는 아무것도 만들지 않는다", async () => {
    const before = existsSync(path.resolve("output")) ? readdirSync(path.resolve("output")).length : 0;
    const res = await exportRoute(post({ rows: [goodRow] }));
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("spreadsheetml");
    expect(decodeURIComponent(res.headers.get("content-disposition") ?? "")).toContain("수정본_");
    const after = existsSync(path.resolve("output")) ? readdirSync(path.resolve("output")).length : 0;
    expect(after).toBe(before);
  });
  it("리포트 엑셀을 내려받을 수 있다", async () => {
    const res = await reportRoute(post({ items: [{ status: "same" }], jobs: [job(true)], unprocessed: [] }));
    expect(res.status).toBe(200);
    expect((await res.arrayBuffer()).byteLength).toBeGreaterThan(1000);
  });
});
