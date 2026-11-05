"use client";

// Design Ref: §1 화면 구성 — 한 페이지 안에서 ① 파일 불러오기 → ② 대조 결과 → ③ 승인 → ④ 입력·리포트 4단계를 따라간다.
// Plan: PLAN.md 14~17번. 업무 규칙은 lib/ 의 순수 함수를 그대로 쓰고, 이 파일은 보여주고 선택을 받는 일만 한다.
// 문구는 쉬운 한국어로, 상태는 색과 글자를 함께 써서 구분한다. (샘플은 가짜 데이터라 값을 그대로 보여준다)

import { useCallback, useEffect, useMemo, useState } from "react";
import { BILLING_SKIP_TEXT } from "@/lib/billing-period";
import { applyDecisions, isResolved, itemKey, needsDecision, type Decision, type DecisionChoice } from "@/lib/decisions";
import { INPUT_FIELD_LABEL, type InputRunCounts } from "@/lib/input-queue";
import { conflictHint } from "@/lib/hint";
import { isFrontOnlyRrn } from "@/lib/normalize";
import { PHONE_KIND_TEXT } from "@/lib/phone-match";
import { applyBilling, computeBilling, type PipelineResult } from "@/lib/pipeline";
import { formatRowId } from "@/lib/row-id";
import type { ExcelRow, FieldKey, InputJob, ReconcileItem, UnprocessedItem } from "@/lib/types";
import { MAX_CONSECUTIVE_FAILURES } from "@/lib/constants";

type Reader = "local" | "llm";
type VerifyResponse = PipelineResult & { today: string; mode: "sample" | "local"; reader: Reader; deployed: boolean };
type InputResponse = {
  jobs: InputJob[];
  unprocessed: UnprocessedItem[];
  stoppedEarly: boolean;
  counts: InputRunCounts;
  compare: { approved: number; done: number; matches: boolean };
  saved: boolean;
};
type FilesInfo = { mode: "sample" | "local"; deployed: boolean; today: string; llm: { available: boolean; model: string }; existing: string[]; city: string[]; phone: string[]; imageCount: number; pdfCount: number };
type SavedState = { updatedAt: string; rows: ExcelRow[]; jobs: InputJob[]; unprocessed: UnprocessedItem[]; stoppedEarly: boolean };
type Tab = "filled" | "conflict" | "needs-check" | "phone" | "billing";

const FIELD_LABEL: Record<FieldKey, string> = {
  name: "성명", phone: "전화번호", address: "주소", rrn: "주민등록번호", occupiedArea: "점유면적(㎡)", ownershipDate: "소유권이전일",
  ownershipEndDate: "소유종료일", lastBillingEndDate: "구청 마지막 부과 종료일", billingStartDate: "부과 시작일", billingEndDate: "부과 종료일",
};
const PHONE_RESULT_TEXT = { same: "같음", filled: "빈칸 보완", conflict: "번호가 달라요(직접 선택)", candidate: "후보(확인 필요)", ambiguous: "번호가 여러 개(확인 필요)", "not-found": "못 찾음(직접 입력)", kept: "참고만(엑셀 값 유지)" } as const;
/** 값의 출처 이름(화면 문구용) */
const sourceName = (item: ReconcileItem) => (item.source.kind === "city-excel" ? "구청 엑셀" : item.source.kind === "phone-excel" ? "전화번호 엑셀" : "등기");
const STEPS = ["파일 불러오기", "대조 결과", "승인", "입력·리포트"] as const;
const GENERIC_ERROR = "처리 중에 문제가 생겼어요. 잠시 뒤에 다시 시도해 주세요.";

async function api<T>(path: string, body?: unknown): Promise<T> {
  const res = await fetch(path, body === undefined ? undefined : { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  if (!res.ok) {
    const data = (await res.json().catch(() => null)) as { error?: string } | null;
    throw new Error(data?.error ?? GENERIC_ERROR);
  }
  return (await res.json()) as T;
}

async function download(path: string, body: unknown, fallbackName: string): Promise<void> {
  const res = await fetch(path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  if (!res.ok) {
    const data = (await res.json().catch(() => null)) as { error?: string } | null;
    throw new Error(data?.error ?? GENERIC_ERROR);
  }
  const blob = await res.blob();
  const match = /filename\*=UTF-8''([^;]+)/.exec(res.headers.get("content-disposition") ?? "");
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = match ? decodeURIComponent(match[1]) : fallbackName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

// 디자인: 흰 카드(rounded-2xl) 위에 검정 pill 버튼. 사무용이라 색은 상태 구분에만 쓰고 움직임은 색 전환 정도로 절제한다. (전역 값은 app/globals.css)
const btn = "min-h-11 rounded-full border border-zinc-300 bg-white px-5 py-2 text-[15px] font-medium text-zinc-900 transition-colors duration-200 hover:border-zinc-900 hover:bg-zinc-50 disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:border-zinc-300 disabled:hover:bg-white";
const btnPrimary = "min-h-11 rounded-full bg-black px-6 py-2 text-[15px] font-semibold text-white transition-colors duration-200 hover:bg-zinc-700 disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-black";
const card = "rounded-3xl border border-zinc-200 bg-white p-5 sm:p-6";
const field = "min-h-11 rounded-full border border-zinc-300 bg-white px-4 text-[15px] transition-colors duration-200 placeholder:text-zinc-400 focus:border-zinc-900";
const tableWrap = "overflow-x-auto rounded-3xl border border-zinc-200 bg-white px-2 py-1";

const Badge = ({ children, tone }: { children: React.ReactNode; tone: "ok" | "warn" | "bad" | "info" }) => {
  const tones = {
    ok: "border-green-200 bg-green-50 text-green-800",
    warn: "border-amber-200 bg-amber-50 text-amber-900",
    bad: "border-red-200 bg-red-50 text-red-800",
    info: "border-zinc-200 bg-zinc-100 text-zinc-700",
  } as const;
  return <span className={`inline-block rounded-full border px-2.5 py-0.5 text-sm font-medium ${tones[tone]}`}>{children}</span>;
};

const show = (v: string | null) => (v == null || v === "" ? "(비어 있음)" : v);

// 가려진 주민등록번호(앞 6자리뿐)는 엑셀에 쓸 수 없으므로 "등기 값 쓰기"를 허용하지 않는다.
const canUseRegistry = (item: ReconcileItem) =>
  (item.registryValue !== null || item.status === "conflict") && !(item.field === "rrn" && isFrontOnlyRrn(item.registryValue));

export default function Workflow() {
  const [step, setStep] = useState<1 | 2 | 3 | 4>(1);
  const [files, setFiles] = useState<FilesInfo | null>(null);
  const [saved, setSaved] = useState<SavedState | null>(null);
  const [data, setData] = useState<VerifyResponse | null>(null);
  const [decisions, setDecisions] = useState<Record<string, Decision>>({});
  const [approval, setApproval] = useState<Record<string, "approved" | "excluded">>({});
  const [finalRows, setFinalRows] = useState<ExcelRow[]>([]);
  const [run, setRun] = useState<InputResponse | null>(null);
  const [tab, setTab] = useState<Tab>("conflict");
  const [failTest, setFailTest] = useState(false);
  // 등기를 읽는 방법. 기본은 이 컴퓨터 안에서 읽기(외부로 안 나감). AI로 읽기는 직원이 직접 골라야만 쓴다.
  const [reader, setReader] = useState<Reader>("local");
  // AI로 읽기를 켜면 위험 안내를 읽고 동의해야만 시작할 수 있다(새로 열 때마다 꺼진 상태로 시작).
  const [llmAck, setLlmAck] = useState(false);
  // 부과 종료일(일괄): 모든 줄의 부과 종료일 상한이다. 비어 있으면 오늘. 파일 목록을 받을 때 서버의 오늘 날짜를 기본값으로 넣는다.
  const [billingEnd, setBillingEnd] = useState("");
  // 3단계(승인) 목록 보기: 전체 / 바뀐 줄 / 새로 추가된 줄 / 아직 못 정한 줄, 그리고 이름·지번 검색
  const [approvalView, setApprovalView] = useState<"all" | "changed" | "new" | "pending">("all");
  const [approvalQuery, setApprovalQuery] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  // 처음 열 때: 불러올 파일 목록과, 이전에 하던 작업이 남아 있는지 확인한다.
  useEffect(() => {
    let alive = true;
    api<FilesInfo>("/api/files").then((f) => { if (!alive) return; setFiles(f); setBillingEnd((cur) => cur || f.today); }).catch((e: Error) => alive && setError(e.message));
    api<{ state: SavedState | null }>("/api/state").then((s) => alive && setSaved(s.state)).catch(() => undefined);
    return () => { alive = false; };
  }, []);

  const guarded = useCallback(async (label: string, fn: () => Promise<void>) => {
    setBusy(label);
    setError(null);
    setNotice(null);
    try {
      await fn();
    } catch (e) {
      setError(e instanceof Error ? e.message : GENERIC_ERROR);
    } finally {
      setBusy(null);
    }
  }, []);

  // 직원의 선택을 반영한 줄들과 아직 해결하지 못한 항목들 (모두 lib/ 의 순수 함수로 계산)
  const applied = useMemo(() => (data ? applyDecisions(data.rows, data.items, decisions) : null), [data, decisions]);
  const unresolvedByRow = useMemo(() => {
    const m = new Map<string, number>();
    applied?.unresolved.forEach((i) => m.set(formatRowId(i.rowId), (m.get(formatRowId(i.rowId)) ?? 0) + 1));
    return m;
  }, [applied]);
  // 직원이 입력한 부과 종료일(올바른 날짜일 때만), 없으면 오늘
  const endCap = /^\d{4}-\d{2}-\d{2}$/.test(billingEnd) ? billingEnd : (data?.today ?? billingEnd);
  const billing = useMemo(() => (data && applied ? computeBilling(applied.rows, endCap) : {}), [data, applied, endCap]);

  const itemsOf = (tabName: Tab): ReconcileItem[] =>
    !data ? [] : tabName === "filled" ? data.items.filter((i) => i.status === "filled") : data.items.filter((i) => i.status === tabName);

  const start = () =>
    guarded(reader === "llm" ? "판독 강화로 등기를 읽는 중이에요… (몇 분 걸릴 수 있어요)" : "검증하는 중이에요… (등기를 읽고 엑셀과 맞춰 보고 있어요)", async () => {
      const result = await api<VerifyResponse>("/api/verify", { reader });
      setData(result);
      setDecisions({});
      setApproval({});
      setRun(null);
      setTab(result.stats.counts.conflict > 0 ? "conflict" : result.stats.counts["needs-check"] > 0 ? "needs-check" : "filled");
      setStep(2);
    });

  const decide = (item: ReconcileItem, choice: DecisionChoice, inputValue?: string) => {
    const key = itemKey(item);
    setDecisions((d) => ({ ...d, [key]: { key, choice, inputValue, at: new Date().toLocaleString("ko-KR") } }));
  };

  // 같은 종류 충돌을 한 번에 정한다. 직원이 버튼을 눌렀을 때만 적용하고, 각 항목에 선택 기록이 남는다.
  const decideMany = (list: ReconcileItem[], choice: "excel" | "registry") => {
    const at = new Date().toLocaleString("ko-KR");
    setDecisions((d) => {
      const next = { ...d };
      for (const i of list) {
        if (choice === "excel" ? i.excelValue == null : !canUseRegistry(i)) continue;
        const key = itemKey(i);
        next[key] = { key, choice, at };
      }
      return next;
    });
  };

  const downloadPhoneSheet = () =>
    guarded("전화번호 대조표를 만드는 중이에요…", () => {
      const finalPhone = new Map((applied?.rows ?? []).map((r) => [formatRowId(r.rowId), r.fields.phone]));
      const rows = (data?.phoneMatches ?? []).map((p) => ({
        rowKey: formatRowId(p.rowId), name: p.name, address: p.address, excelPhone: p.excelPhone, foundPhone: p.found,
        finalPhone: finalPhone.get(formatRowId(p.rowId)) ?? null, kind: p.kind, result: PHONE_RESULT_TEXT[p.result],
      }));
      return download("/api/phone-export", { rows }, "전화번호대조표.xlsx");
    });

  // 줄마다 "자동으로 채워지거나 고쳐졌거나 직원이 바꾼" 항목을 모아, 승인할 때 무엇이 바뀌었는지 보여 준다.
  const changesByRow = useMemo(() => {
    const m = new Map<string, { notes: Array<{ text: string; tone: "ok" | "warn" | "info" }>; fields: Set<FieldKey> }>();
    if (!data) return m;
    // 사내 프로그램에 입력되는 항목(성명·전화번호·주소·주민등록번호)이 바뀐 줄만 "바뀐 줄"로 센다.
    // 점유면적·날짜처럼 입력과 상관없는 항목의 변경은 수정본 엑셀에만 반영되므로 흐리게 따로 알려 준다.
    const add = (key: string, field: FieldKey, text: string, tone: "ok" | "warn") => {
      const cur = m.get(key) ?? { notes: [], fields: new Set<FieldKey>() };
      const inInput = field === "name" || field === "phone" || field === "address" || field === "rrn";
      cur.notes.push({ text: `${FIELD_LABEL[field]}: ${text}${inInput ? "" : " (수정본에만 반영)"}`, tone: inInput ? tone : "info" });
      if (inInput) cur.fields.add(field);
      m.set(key, cur);
    };
    for (const i of data.items) {
      const key = formatRowId(i.rowId);
      if (i.status === "filled") add(key, i.field, i.registryWins ? "등기 기준으로 고침" : `${sourceName(i)}로 보완`, i.registryWins ? "warn" : "ok");
      else if (needsDecision(i)) {
        const d = decisions[itemKey(i)];
        if (d && d.choice !== "excel") add(key, i.field, d.choice === "input" ? "직접 입력" : `${sourceName(i)} 값으로 바꿈`, "warn");
      }
    }
    return m;
  }, [data, decisions]);

  const rowKeys = applied?.rows.map((r) => formatRowId(r.rowId)) ?? [];
  const approvedKeys = rowKeys.filter((k) => approval[k] === "approved");
  const excludedKeys = rowKeys.filter((k) => approval[k] === "excluded");

  const startInput = () =>
    guarded("모의 입력 중이에요…", async () => {
      if (!applied) return;
      const finalRowsWithBilling = applyBilling(applied.rows, endCap);
      const jobs: InputJob[] = applied.rows.map((r) => ({
        rowId: r.rowId, approved: approval[formatRowId(r.rowId)] === "approved", status: "pending", reason: null,
      }));
      const failKeys = failTest ? approvedKeys.slice(0, MAX_CONSECUTIVE_FAILURES + 1) : [];
      setFinalRows(finalRowsWithBilling);
      setRun(await api<InputResponse>("/api/input", { rows: finalRowsWithBilling, jobs, failKeys }));
      setStep(4);
    });

  const resume = () =>
    guarded("미처리 줄만 이어서 처리하는 중이에요…", async () => {
      if (!run) return;
      setRun(await api<InputResponse>("/api/input", { rows: finalRows, jobs: run.jobs, failKeys: [] }));
    });

  const resumeSaved = () => {
    if (!saved) return;
    setFinalRows(saved.rows);
    setRun({
      jobs: saved.jobs, unprocessed: saved.unprocessed, stoppedEarly: saved.stoppedEarly, saved: true,
      counts: { done: 0, skipped: 0, failed: 0, excluded: 0, notAttempted: 0 },
      compare: { approved: saved.jobs.filter((j) => j.approved).length, done: saved.jobs.filter((j) => j.approved && j.status === "done").length, matches: false },
    });
    setStep(4);
  };

  const clearAll = () =>
    guarded("자료를 지우는 중이에요…", async () => {
      await api<{ removed: string[] }>("/api/clear", {});
      setSaved(null);
      setRun(null);
      setData(null);
      setDecisions({});
      setApproval({});
      setStep(1);
      setNotice("작업 상태와 입력 기록을 지웠어요. 내려받은 수정본은 직접 확인한 뒤 지워 주세요.");
    });

  const counts = data?.stats.counts;
  const unresolvedTotal = applied?.unresolved.length ?? 0;

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-col gap-3">
        <div className="flex items-center justify-between gap-3">
          <h1 className="text-base font-semibold tracking-[-0.03em] sm:text-lg">등기 대조·입력 도우미</h1>
          <p className="text-sm text-[var(--muted)]" aria-live="polite">{step} / 4 단계 · {STEPS[step - 1]}</p>
        </div>
        <div role="progressbar" aria-label="진행 단계" aria-valuemin={1} aria-valuemax={4} aria-valuenow={step} className="h-[3px] w-full rounded-full bg-zinc-300">
          <div className="h-full rounded-full bg-black transition-all duration-300" style={{ width: `${step * 25}%` }} />
        </div>
        <p className="text-sm leading-6 text-[var(--muted)]">등기 내용을 엑셀과 맞춰 보고, 직원이 승인한 건만 입력하는 앱이에요. 연습용 가짜(샘플) 데이터로만 동작해요.</p>
      </header>

      {busy && <p role="status" className="rounded-2xl border border-zinc-200 bg-white p-4 text-base">{busy}</p>}
      {error && <p role="alert" className="rounded-2xl border border-red-200 bg-red-50 p-4 text-base text-red-900">{error}</p>}
      {notice && <p role="status" className="rounded-2xl border border-green-200 bg-green-50 p-4 text-base text-green-900">{notice}</p>}

      {step === 1 && (
        <section className="flex flex-col gap-4" aria-label="파일 불러오기">
          <h2 className="text-2xl font-semibold tracking-[-0.03em]">1. 파일 불러오기</h2>
          {files?.deployed ? (
            <p className="rounded-2xl border border-amber-200 bg-amber-50 p-4 text-base leading-7 text-amber-900">
              이 화면은 <strong>연습용 가짜 데이터로 보여 주는 시연판</strong>이에요. 미리 읽어 둔 결과를 쓰고, 파일 저장은 하지 않아요.
            </p>
          ) : (
            <p className="text-base leading-7 text-[var(--muted)]">
              {files?.mode === "local"
                ? files.pdfCount > 0
                  ? `이 컴퓨터에서 가짜 등기 PDF ${files.pdfCount}건의 글자를 그대로 꺼내 읽어요(몇 초).`
                  : "이 컴퓨터에서 가짜 등기 그림을 실제로 읽어요(100장, 몇 분 걸릴 수 있어요)."
                : "연습용 가짜 데이터의 미리 읽어 둔 결과를 써요."}
            </p>
          )}
          <div className={card}>
            <h3 className="mb-2 text-lg font-semibold">불러올 파일</h3>
            {files ? (
              <ul className="list-disc pl-5 text-base leading-8">
                <li>기존 엑셀: {files.existing.join(", ") || "없음"}</li>
                <li>구청 부과 이력 엑셀: {files.city.join(", ") || "없음"}</li>
                <li>전화번호 엑셀: {files.phone.join(", ") || "없음 (없으면 전화번호 대조를 건너뛰어요)"}</li>
                <li>
                  등기 파일: {files.pdfCount > 0 && !files.deployed ? `PDF ${files.pdfCount}건 (PDF 안의 글자를 그대로 읽어요)` : `그림 ${files.imageCount}장`}{" "}
                  {files.deployed && "(시연판은 미리 읽어 둔 결과 사용)"}
                </li>
              </ul>
            ) : <p className="text-base">파일 목록을 불러오는 중이에요…</p>}
          </div>
          <div className={card}>
            <h3 className="text-lg font-semibold">부과 종료일 (일괄 입력)</h3>
            <p className="mt-1 text-base leading-7 text-[var(--muted)]">
              모든 줄의 부과 종료일로 쓸 날짜예요. 소유자가 이미 바뀐 줄은 소유종료일 하루 전까지만 계산해요.
              부과 시작일은 구청 마지막 부과 종료일 다음 날이고, 토·일요일이면 다음 월요일이에요.
            </p>
            <label className="mt-3 flex flex-wrap items-center gap-3 text-base">
              <span className="font-medium">부과 종료일</span>
              <input type="date" value={billingEnd} onChange={(e) => setBillingEnd(e.target.value)} className={field} aria-label="부과 종료일 일괄 입력" />
              <span className="text-sm text-[var(--muted)]">{billingEnd ? "" : "비워 두면 오늘로 계산해요."}</span>
            </label>
          </div>
          {saved && !files?.deployed && (
            <div className={`${card} border-amber-500`}>
              <p className="text-base leading-7">이전에 하던 작업이 남아 있어요. ({new Date(saved.updatedAt).toLocaleString("ko-KR")}, 승인한 {saved.jobs.filter((j) => j.approved).length}줄 중 {saved.jobs.filter((j) => j.approved && j.status === "done").length}줄 입력 완료)</p>
              <button className={`${btn} mt-2`} onClick={resumeSaved}>이어서 하기</button>
            </div>
          )}
          {files?.llm.available && !files.deployed && (
            <div className={`${card} ${reader === "llm" ? "border-red-600" : ""}`}>
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <h3 className="text-lg font-semibold">판독 강화</h3>
                  <p className="text-base text-[var(--muted)]">
                    {reader === "llm" ? `켜짐 — 외부 AI(${files.llm.model})가 등기를 한 번 더 읽어요.` : "꺼짐 — 이 컴퓨터 안에서만 읽어요. 파일이 컴퓨터 밖으로 나가지 않아요."}
                  </p>
                </div>
                <button
                  type="button" role="switch" aria-checked={reader === "llm"} aria-label="판독 강화"
                  onClick={() => { setReader((r) => (r === "llm" ? "local" : "llm")); setLlmAck(false); }}
                  className={`relative h-8 w-14 shrink-0 rounded-full border-2 transition-colors ${reader === "llm" ? "border-red-700 bg-red-600" : "border-zinc-500 bg-zinc-300"}`}>
                  <span className={`absolute top-0.5 h-6 w-6 rounded-full bg-white shadow transition-all ${reader === "llm" ? "left-6" : "left-0.5"}`} />
                </button>
              </div>
              {reader === "llm" && (
                <div role="alert" className="mt-3 rounded-2xl border border-red-200 bg-red-50 p-4 text-base leading-7 text-red-900">
                  <p><strong>⚠ 정보가 외부로 나갈 수 있어요.</strong></p>
                  <ul className="list-disc pl-5">
                    <li>등기 파일(이름·주소·주민등록번호 앞자리 등)이 <strong>외부 서버(OpenAI)로 전송</strong>돼요. 한 번 보내면 되돌릴 수 없어요.</li>
                    <li>사내 규정 확인 전에는 실제 등기·개인정보를 보내면 안 돼요. 지금은 <strong>가짜 샘플 파일(fake-)만</strong> 보내고, 실제 파일은 막혀 있어요.</li>
                    <li>AI는 틀려도 자신 있게 답할 수 있어서, 이 컴퓨터에서 읽을 때보다 틀린 값이 섞일 수 있어요. 글자가 들어 있는 PDF는 이 컴퓨터에서 읽는 편이 더 정확하고 빨라요.</li>
                    <li>사용 요금이 들어요.</li>
                  </ul>
                  <label className="mt-2 flex items-start gap-2">
                    <input type="checkbox" className="mt-1.5 h-5 w-5" checked={llmAck} onChange={(e) => setLlmAck(e.target.checked)} />
                    <span>위 내용을 이해했고, 가짜 샘플 파일을 외부로 보내는 데 동의해요.</span>
                  </label>
                </div>
              )}
            </div>
          )}
          <div><button className={btnPrimary} onClick={start} disabled={!files || busy !== null || (reader === "llm" && !llmAck)}>검증 시작</button>
            {reader === "llm" && !llmAck && <span className="ml-3 text-base text-red-800">위험 안내에 동의해야 시작할 수 있어요.</span>}
          </div>
        </section>
      )}

      {step === 2 && data && counts && (
        <section className="flex flex-col gap-4" aria-label="대조 결과">
          <h2 className="text-2xl font-semibold tracking-[-0.03em]">2. 대조 결과</h2>
          <p className="text-base leading-7 text-[var(--muted)]">
            등기 {data.stats.registries}장을 {data.reader === "llm" ? "판독 강화로" : "이 컴퓨터에서"} 읽고 엑셀 {data.stats.rows}줄과 맞춰 봤어요. (최대 {data.stats.maxRounds}회 반복 확인, 3회까지 간 등기 {data.verify.filter((v) => v.rounds === 3).length}장)
          </p>
          <div className="rounded-[28px] bg-black p-6 text-white sm:p-7">
            <p className="text-sm text-zinc-400">직원이 확인할 항목</p>
            <div className="mt-2 flex flex-wrap items-end justify-between gap-x-8 gap-y-5">
              <p className="text-6xl font-semibold leading-none tracking-[-0.05em]">
                {unresolvedTotal}
                <span className="ml-2 text-base font-normal tracking-normal text-zinc-400">/ {counts.conflict + counts["needs-check"]}개 남음 (전체 {counts.same + counts.filled + counts.conflict + counts["needs-check"]}개)</span>
              </p>
              <dl className="flex flex-wrap gap-x-7 gap-y-2 text-sm text-zinc-400">
                {([["같음", counts.same], ["자동 보완", counts.filled], ["충돌", counts.conflict], ["확인 필요", counts["needs-check"]]] as Array<[string, number]>).map(([label, n]) => (
                  <div key={label}><dt>{label}</dt><dd className="text-2xl font-semibold tracking-[-0.03em] text-white">{n}</dd></div>
                ))}
              </dl>
            </div>
          </div>
          <div role="tablist" aria-label="결과 종류" className="flex flex-wrap gap-2">
            {([["conflict", `충돌 ${counts.conflict}`], ["needs-check", `확인 필요 ${counts["needs-check"]}`], ["filled", `자동 보완 ${counts.filled}`], ...(data.phoneMatches.length > 0 ? [["phone", "전화번호"] as [Tab, string]] : []), ["billing", "부과 기간"]] as Array<[Tab, string]>).map(([id, label]) => (
              <button key={id} role="tab" aria-selected={tab === id} onClick={() => setTab(id)}
                className={`${btn} ${tab === id ? "!border-black !bg-black font-semibold !text-white" : ""}`}>{label}</button>
            ))}
          </div>

          {tab === "filled" && (
            <div className={tableWrap}>
              <table className="w-full text-left text-base">
                <thead><tr className="border-b border-zinc-200 text-sm text-[var(--muted)]"><th className="p-2">줄</th><th className="p-2">항목</th><th className="p-2">채운 값</th><th className="p-2">출처</th></tr></thead>
                <tbody>
                  {itemsOf("filled").map((i) => (
                    <tr key={itemKey(i)} className="border-b border-zinc-200">
                      <td className="p-2">{formatRowId(i.rowId)} {i.isNewRow && <Badge tone="warn">새로 추가된 줄</Badge>}</td>
                      <td className="p-2">{FIELD_LABEL[i.field]}</td>
                      <td className="p-2">
                        {show(i.registryValue)}
                        {i.registryWins && <div className="text-sm text-[var(--muted)]"><Badge tone="warn">등기 기준으로 고침</Badge> 엑셀에는 {show(i.excelValue)}</div>}
                      </td>
                      <td className="p-2">{i.source.kind === "city-excel" ? "구청 엑셀" : `등기 ${i.source.file ?? ""}`} · {i.round}회차</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {(tab === "conflict" || tab === "needs-check") && (
            <div className="flex flex-col gap-3">
              {itemsOf(tab).length === 0 && <p className="text-base">이 종류의 항목이 없어요.</p>}
              {tab === "conflict" && (() => {
                // 같은 항목(예: 주소)끼리 묶어서 한 번에 정할 수 있게 한다.
                const groups = new Map<FieldKey, ReconcileItem[]>();
                itemsOf("conflict").forEach((i) => groups.set(i.field, [...(groups.get(i.field) ?? []), i]));
                return [...groups.entries()].filter(([, list]) => list.length >= 2).map(([field, list]) => (
                  <div key={field} className="flex flex-wrap items-center gap-2 rounded-2xl border border-zinc-200 bg-white p-4">
                    <strong className="text-base">{FIELD_LABEL[field]} 충돌 {list.length}건</strong>
                    <span className="text-sm text-[var(--muted)]">같은 종류를 한 번에 정할 수 있어요. 정한 뒤에도 항목마다 바꿀 수 있어요.</span>
                    <button className={btn} onClick={() => decideMany(list, "excel")}>모두 엑셀 값 그대로 두기</button>
                    {list.some(canUseRegistry) && <button className={btn} onClick={() => decideMany(list, "registry")}>모두 {sourceName(list[0])} 값 쓰기</button>}
                  </div>
                ));
              })()}
              {itemsOf(tab).map((i) => (
                <ItemCard key={itemKey(i)} item={i} decision={decisions[itemKey(i)]} onDecide={(c, v) => decide(i, c, v)}
                  viewFile={!data.deployed && i.source.kind === "registry" ? i.source.file : undefined} />
              ))}
            </div>
          )}

          {tab === "phone" && (
            <div className="flex flex-col gap-3">
              <p className="text-base leading-7 text-[var(--muted)]">
                전화번호는 등기에 없어서, 전화번호 엑셀의 이름·주소와 맞춰 봤어요. 이름과 주소가 모두 같은 기록만 빈칸을 채우고, 나머지는 후보로만 보여 드려요.
              </p>
              <div className="flex flex-wrap gap-3">
                <button className={btn} disabled={busy !== null} onClick={downloadPhoneSheet}>전화번호 대조표 엑셀 받기</button>
              </div>
              <div className={tableWrap}>
                <table className="w-full text-left text-base">
                  <thead><tr className="border-b border-zinc-200 text-sm text-[var(--muted)]"><th className="p-2">줄</th><th className="p-2">성명</th><th className="p-2">주소</th><th className="p-2">기존 엑셀 번호</th><th className="p-2">전화번호 엑셀 번호</th><th className="p-2">근거</th><th className="p-2">판단</th></tr></thead>
                  <tbody>
                    {data.phoneMatches.map((p) => (
                      <tr key={formatRowId(p.rowId)} className="border-b border-zinc-200">
                        <td className="p-2">{formatRowId(p.rowId)}</td><td className="p-2">{show(p.name)}</td><td className="p-2">{show(p.address)}</td>
                        <td className="p-2">{show(p.excelPhone)}</td>
                        <td className="p-2">{p.candidates.length > 1 ? p.candidates.join(" / ") : show(p.found)}</td>
                        <td className="p-2">{PHONE_KIND_TEXT[p.kind]}</td>
                        <td className="p-2"><Badge tone={p.result === "same" || p.result === "filled" ? "ok" : p.result === "kept" ? "info" : p.result === "conflict" ? "bad" : "warn"}>{PHONE_RESULT_TEXT[p.result]}</Badge></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {tab === "billing" && (
            <div className={tableWrap}>
              <p className="mb-2 px-2 pt-2 text-base text-[var(--muted)]">부과 종료일은 {endCap}이에요. 구청 마지막 부과 종료일 다음 날(토·일이면 다음 월요일)부터 부과 종료일까지, 소유자별로 계산해요.</p>
              <table className="w-full text-left text-base">
                <thead><tr className="border-b border-zinc-200 text-sm text-[var(--muted)]"><th className="p-2">줄</th><th className="p-2">성명</th><th className="p-2">점유면적(㎡)</th><th className="p-2">소유권이전일</th><th className="p-2">소유종료일</th><th className="p-2">구청 마지막 부과 종료일</th><th className="p-2">부과 기간</th></tr></thead>
                <tbody>
                  {applied?.rows.map((r) => {
                    const b = billing[formatRowId(r.rowId)];
                    return (
                      <tr key={formatRowId(r.rowId)} className="border-b border-zinc-200">
                        <td className="p-2">{formatRowId(r.rowId)}</td><td className="p-2">{show(r.fields.name)}</td>
                        <td className="p-2">{show(r.fields.occupiedArea)}</td>
                        <td className="p-2">{show(r.fields.ownershipDate)}</td><td className="p-2">{show(r.fields.ownershipEndDate)}</td>
                        <td className="p-2">{show(r.fields.lastBillingEndDate)}</td>
                        <td className="p-2">{b?.target ? `${b.start} ~ ${b.end}` : b ? BILLING_SKIP_TEXT[b.reason] : ""}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}

          <div className="flex flex-wrap items-center gap-3">
            <button className={btn} onClick={() => setStep(1)}>이전</button>
            <button className={btnPrimary} onClick={() => setStep(3)}>다음: 승인하기</button>
            <span className="text-base">아직 정하지 못한 항목: {unresolvedTotal}개</span>
          </div>
        </section>
      )}

      {step === 3 && applied && data && (() => {
        const q = approvalQuery.trim().replace(/\s+/g, "");
        const isChanged = (k: string) => (changesByRow.get(k)?.fields.size ?? 0) > 0;
        const viewCounts = {
          all: rowKeys.length,
          changed: rowKeys.filter(isChanged).length,
          new: rowKeys.filter((k) => data.newRowKeys.includes(k)).length,
          pending: rowKeys.filter((k) => unresolvedByRow.has(k)).length,
        };
        const shown = applied.rows.filter((r) => {
          const k = formatRowId(r.rowId);
          if (approvalView === "changed" && !isChanged(k)) return false;
          if (approvalView === "new" && !data.newRowKeys.includes(k)) return false;
          if (approvalView === "pending" && !unresolvedByRow.has(k)) return false;
          return q === "" || (`${k}${r.fields.name ?? ""}`).replace(/\s+/g, "").includes(q);
        });
        const approveWhere = (test: (k: string) => boolean) =>
          setApproval((a) => ({ ...a, ...Object.fromEntries(rowKeys.filter((k) => !unresolvedByRow.has(k) && !a[k] && test(k)).map((k) => [k, "approved" as const])) }));
        return (
        <section className="flex flex-col gap-4" aria-label="승인">
          <h2 className="text-2xl font-semibold tracking-[-0.03em]">3. 승인</h2>
          <div className={card}>
            <p className="text-base font-medium">이 단계는 사내 프로그램에 입력해도 되는 줄을 고르는 마지막 확인이에요.</p>
            <ul className="mt-2 list-disc pl-5 text-base leading-7 text-[var(--muted)]">
              <li><strong className="text-black">승인</strong>: 아래 &lsquo;입력될 값&rsquo;을 그대로 사내 프로그램에 입력해요.</li>
              <li><strong className="text-black">제외</strong>: 이 줄은 입력하지 않고 건너뛰어요. (소유자가 의심스럽거나, 엑셀에만 있는 줄 등)</li>
              <li>&lsquo;바뀐 내용&rsquo;은 2단계에서 자동으로 채우거나 고치거나 직접 바꾼 항목이에요. 바뀐 줄을 눈여겨보세요.</li>
              <li>충돌·확인 필요를 아직 정하지 못한 줄은 승인할 수 없어요.</li>
            </ul>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {([["all", "전체"], ["changed", "바뀐 줄"], ["new", "새로 추가된 줄"], ["pending", "아직 못 정한 줄"]] as Array<["all" | "changed" | "new" | "pending", string]>).map(([id, label]) => (
              <button key={id} aria-pressed={approvalView === id} onClick={() => setApprovalView(id)}
                className={`${btn} ${approvalView === id ? "!border-black !bg-black font-semibold !text-white" : ""}`}>{label} {viewCounts[id]}</button>
            ))}
            <input value={approvalQuery} onChange={(e) => setApprovalQuery(e.target.value)} placeholder="이름·지번 검색" aria-label="이름이나 지번으로 검색" maxLength={50} className={`${field} min-w-52`} />
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <button className={btn} onClick={() => approveWhere((k) => !isChanged(k))}>바뀌지 않은 줄 모두 승인</button>
            <button className={btn} onClick={() => approveWhere(() => true)}>정해진 줄 모두 승인</button>
            <span className="text-base">승인 {approvedKeys.length}건 / 제외 {excludedKeys.length}건 / 아직 안 정함 {rowKeys.length - approvedKeys.length - excludedKeys.length}건</span>
          </div>
          <div className={tableWrap}>
            <table className="w-full text-left text-base">
              <thead><tr className="border-b border-zinc-200 text-sm text-[var(--muted)]"><th className="p-2">줄</th><th className="p-2">입력될 값</th><th className="p-2">바뀐 내용·상태</th><th className="p-2">선택</th></tr></thead>
              <tbody>
                {shown.length === 0 && <tr><td colSpan={4} className="p-4 text-[var(--muted)]">이 조건에 맞는 줄이 없어요.</td></tr>}
                {shown.map((r) => {
                  const key = formatRowId(r.rowId);
                  const pending = unresolvedByRow.get(key) ?? 0;
                  const a = approval[key];
                  const ch = changesByRow.get(key);
                  const b = billing[key];
                  const values: Array<[string, FieldKey, string | null]> = [
                    ["성명", "name", r.fields.name], ["전화번호", "phone", r.fields.phone], ["주소", "address", r.fields.address], ["주민등록번호", "rrn", r.fields.rrn],
                  ];
                  return (
                    <tr key={key} className="border-b border-zinc-200 align-top">
                      <td className="p-2 font-medium">{key}</td>
                      <td className="p-2">
                        <dl className="grid grid-cols-[5.5rem_1fr] gap-x-3 gap-y-0.5 text-[15px]">
                          {values.map(([label, field, v]) => (
                            <div key={field} className="contents">
                              <dt className="text-[var(--muted)]">{label}</dt>
                              <dd className={ch?.fields.has(field) ? "font-semibold" : ""}>{show(v)}</dd>
                            </div>
                          ))}
                        </dl>
                        <p className="mt-1 text-sm text-[var(--muted)]">부과 기간: {b?.target ? `${b.start} ~ ${b.end}` : b ? BILLING_SKIP_TEXT[b.reason] : "-"}</p>
                      </td>
                      <td className="p-2">
                        <div className="flex flex-col items-start gap-1">
                          {data.newRowKeys.includes(key) && <Badge tone="warn">새로 추가된 줄</Badge>}
                          {data.orphanRowKeys.includes(key) && <Badge tone="warn">엑셀에만 있는 줄</Badge>}
                          {ch?.notes.map((n) => <Badge key={n.text} tone={n.tone}>{n.text}</Badge>)}
                          {!ch?.notes.length && !data.newRowKeys.includes(key) && !data.orphanRowKeys.includes(key) && <span className="text-sm text-[var(--muted)]">바뀐 내용 없음</span>}
                          {pending > 0 ? <Badge tone="bad">정하지 못한 항목 {pending}개</Badge> : a === "approved" ? <Badge tone="ok">승인</Badge> : a === "excluded" ? <Badge tone="info">제외</Badge> : <Badge tone="info">대기</Badge>}
                        </div>
                      </td>
                      <td className="p-2">
                        <div className="flex gap-2 whitespace-nowrap">
                          <button className={btn} disabled={pending > 0} onClick={() => setApproval((x) => ({ ...x, [key]: "approved" }))}>승인</button>
                          <button className={btn} onClick={() => setApproval((x) => ({ ...x, [key]: "excluded" }))}>제외</button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <label className="flex items-center gap-2 text-base">
            <input type="checkbox" className="h-5 w-5" checked={failTest} onChange={(e) => setFailTest(e.target.checked)} />
            시험용: 승인한 줄 중 앞의 {MAX_CONSECUTIVE_FAILURES + 1}줄을 일부러 실패시키기 (연속 {MAX_CONSECUTIVE_FAILURES}건 실패하면 멈추는지 확인)
          </label>
          <div className="flex flex-wrap items-center gap-3">
            <button className={btn} onClick={() => setStep(2)}>이전</button>
            <button className={btnPrimary} disabled={approvedKeys.length === 0 || busy !== null} onClick={startInput}>입력 시작</button>
          </div>
        </section>
        );
      })()}

      {step === 4 && run && (
        <section className="flex flex-col gap-4" aria-label="입력과 리포트">
          <h2 className="text-2xl font-semibold tracking-[-0.03em]">4. 입력·리포트</h2>
          <p className="text-base leading-7 text-[var(--muted)]">실제 사내 프로그램이 아니라 <strong>모의 입력</strong>이에요. 입력하는 항목은 지번주소·성명·전화번호·주소·주민등록번호 다섯 개뿐이에요.</p>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
            {([["입력 완료", run.counts.done], ["이미 입력해서 건너뜀", run.counts.skipped], ["실패", run.counts.failed], ["제외", run.counts.excluded], ["멈춰서 못 함", run.counts.notAttempted]] as Array<[string, number]>).map(([label, n]) => (
              <div key={label} className={card}><div className="text-sm text-[var(--muted)]">{label}</div><div className="mt-1 text-3xl font-semibold tracking-[-0.03em]">{n}</div></div>
            ))}
          </div>
          <p role="status" className={`rounded-2xl border p-4 text-base ${run.compare.matches ? "border-green-200 bg-green-50 text-green-900" : "border-amber-200 bg-amber-50 text-amber-900"}`}>
            건수 비교: 승인 {run.compare.approved}건 / 입력 완료 {run.compare.done}건 — {run.compare.matches ? "모두 입력됐어요." : `${run.compare.approved - run.compare.done}건이 아직 입력되지 않았어요.`}
          </p>
          {run.stoppedEarly && (
            <p role="alert" className="rounded-2xl border border-red-200 bg-red-50 p-4 text-base text-red-900">
              입력이 계속 실패해서 멈췄어요. 아래 미처리 목록을 확인해 주세요.
            </p>
          )}
          <div>
            <h3 className="mb-2 text-lg font-semibold">미처리 목록 ({run.unprocessed.length}건)</h3>
            {run.unprocessed.length === 0 ? <p className="text-base">미처리 줄이 없어요.</p> : (
              <div className={tableWrap}>
                <table className="w-full text-left text-base">
                  <thead><tr className="border-b border-zinc-200 text-sm text-[var(--muted)]"><th className="p-2">줄</th><th className="p-2">항목</th><th className="p-2">사유</th></tr></thead>
                  <tbody>
                    {run.unprocessed.map((u) => (
                      <tr key={formatRowId(u.rowId)} className="border-b border-zinc-200">
                        <td className="p-2">{formatRowId(u.rowId)}</td><td className="p-2">{u.field ? INPUT_FIELD_LABEL[u.field] : "줄 전체"}</td><td className="p-2">{u.reason}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
          <div className="flex flex-wrap gap-3">
            <button className={btn} disabled={run.unprocessed.length === 0 || busy !== null} onClick={resume}>미처리 줄만 이어서 처리</button>
            <button className={btn} disabled={busy !== null} onClick={() => guarded("수정본을 만드는 중이에요…", () => download("/api/export", { rows: finalRows }, "수정본.xlsx"))}>수정본 엑셀 받기</button>
            {(data?.phoneMatches.length ?? 0) > 0 && <button className={btn} disabled={busy !== null} onClick={downloadPhoneSheet}>전화번호 대조표 받기</button>}
            <button className={btn} disabled={busy !== null} onClick={() => guarded("리포트를 만드는 중이에요…", () => download("/api/report", { items: data?.items.map((i) => ({ status: i.status })) ?? [], jobs: run.jobs, unprocessed: run.unprocessed }, "결과리포트.xlsx"))}>결과 리포트 받기</button>
            {!data?.deployed && !files?.deployed && <button className={btn} disabled={busy !== null} onClick={clearAll}>작업 끝내기·자료 지우기</button>}
          </div>
          {run.saved && <p className="text-base text-[var(--muted)]">이 컴퓨터의 작업 폴더(.work)에 진행 상태를 저장했어요. 끝나면 &lsquo;자료 지우기&rsquo;를 눌러 주세요.</p>}
        </section>
      )}
    </div>
  );
}

function ItemCard({ item, decision, onDecide, viewFile }: { item: ReconcileItem; decision?: Decision; onDecide: (choice: DecisionChoice, input?: string) => void; viewFile?: string }) {
  const [text, setText] = useState("");
  const [open, setOpen] = useState(false);
  const resolved = isResolved(item, decision ? { [itemKey(item)]: decision } : {});
  const canKeep = item.excelValue != null;
  const canRegistry = canUseRegistry(item);
  const hint = item.status === "conflict" ? conflictHint(item.field, item.excelValue, item.registryValue) : null;
  return (
    <div className={card}>
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <strong className="text-base">{formatRowId(item.rowId)} · {FIELD_LABEL[item.field]}</strong>
        <Badge tone={item.status === "conflict" ? "bad" : "warn"}>{item.status === "conflict" ? "충돌" : "확인 필요"}</Badge>
        {item.isNewRow && <Badge tone="warn">새로 추가된 줄</Badge>}
        {resolved && needsDecision(item) && <Badge tone="ok">정함</Badge>}
      </div>
      {item.note && <p className="mb-2 text-base">{item.note}</p>}
      {hint && <p className="mb-2 text-base text-amber-900">참고: {hint}</p>}
      <dl className="mb-3 grid grid-cols-1 gap-1 text-base sm:grid-cols-2">
        <div><dt className="text-sm text-[var(--muted)]">엑셀 값</dt><dd>{show(item.excelValue)}</dd></div>
        <div>
          <dt className="text-sm text-[var(--muted)]">{sourceName(item)} 값{item.confidence !== undefined &&
            (item.source.file?.toLowerCase().endsWith(".pdf")
              ? item.confidence >= 90 ? " (PDF 안의 글자를 그대로 읽음)" : " (PDF 글자가 이상해서 믿기 어려워요)"
              : ` (읽은 글자 확신도 ${Math.round(item.confidence)}%)`)}</dt>
          <dd>{show(item.registryValue)}</dd>
        </div>
      </dl>
      <div className="flex flex-wrap items-center gap-2">
        {canKeep && <button className={btn} onClick={() => onDecide("excel")}>엑셀 값 그대로 두기</button>}
        {canRegistry && <button className={btn} onClick={() => onDecide("registry")}>{item.registryValue === null ? "비워 두기(등기 기준)" : `${sourceName(item)} 값 쓰기`}</button>}
        <label className="flex items-center gap-2 text-base">
          <span className="sr-only">직접 입력</span>
          <input value={text} onChange={(e) => setText(e.target.value)} placeholder="직접 입력" maxLength={200}
            className={field} />
        </label>
        <button className={btn} disabled={text.trim() === ""} onClick={() => onDecide("input", text.trim())}>이 값으로 정하기</button>
        {viewFile && <button className={btn} aria-expanded={open} onClick={() => setOpen((o) => !o)}>{open ? "원본 등기 닫기" : "원본 등기 보기"}</button>}
      </div>
      {open && viewFile && (
        <div className="mt-3">
          <p className="mb-1 text-sm text-[var(--muted)]">원본 파일: {viewFile} (갑구 소유권 사항을 찾아보세요)</p>
          {viewFile.toLowerCase().endsWith(".pdf")
            ? <iframe title={`원본 등기 ${viewFile}`} src={`/api/source?file=${encodeURIComponent(viewFile)}`} className="h-[560px] w-full rounded-2xl border border-zinc-200" />
            // eslint-disable-next-line @next/next/no-img-element
            : <img alt={`원본 등기 ${viewFile}`} src={`/api/source?file=${encodeURIComponent(viewFile)}`} className="max-h-[560px] w-full rounded-2xl border border-zinc-200 object-contain" />}
        </div>
      )}
      {decision && (
        <p className="mt-2 text-base">
          선택: {decision.choice === "excel" ? "엑셀 값 그대로" : decision.choice === "registry" ? (item.registryValue === null ? "비워 두기" : "등기 값 사용") : `직접 입력 (${decision.inputValue})`}
        </p>
      )}
    </div>
  );
}
