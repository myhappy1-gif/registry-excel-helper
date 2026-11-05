"use client";

// Design Ref: §1 화면 구성 — 한 페이지 안에서 ① 파일 불러오기 → ② 대조 결과 → ③ 승인 → ④ 입력·리포트 4단계를 따라간다.
// Plan: PLAN.md 14~17번. 업무 규칙은 lib/ 의 순수 함수를 그대로 쓰고, 이 파일은 보여주고 선택을 받는 일만 한다.
// 디자인(2026-11-05 개편): 네이비 상단 바 + 단계 탭, 충돌은 카드가 아니라 비교 표, 아래쪽 고정 바에 "남은 확인 N개". 색은 의미대로(네이비 기본 / 레드 충돌 / 그레이 보조).

import Link from "next/link";
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
/** 숫자는 천 단위 쉼표를 넣어 읽기 쉽게 보여 준다. */
const fmt = (n: number) => n.toLocaleString("ko-KR");

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

// ── 스타일 조각 ── (색 이름은 app/globals.css: navy 기본 / brand 레드 / line 구분선 / muted 보조 글자 / wash 바탕)
// 버튼: 주요 동작 하나만 네이비로 채우고, 나머지는 윤곽선만 둔다.
const btn = "inline-flex min-h-10 items-center justify-center whitespace-nowrap rounded-lg border border-[#c9cedb] bg-white px-4 py-1.5 text-[14px] font-medium text-navy transition-colors duration-150 hover:border-navy hover:bg-navy-tint disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:border-[#c9cedb] disabled:hover:bg-white";
const btnPrimary = "inline-flex min-h-10 items-center justify-center whitespace-nowrap rounded-lg bg-navy px-5 py-1.5 text-[14px] font-semibold text-white transition-colors duration-150 hover:bg-navy-hover disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-navy";
const btnSm = "inline-flex min-h-8 items-center justify-center whitespace-nowrap rounded-md border px-3 py-1 text-[13px] font-medium transition-colors duration-150 disabled:cursor-not-allowed disabled:opacity-40";
const btnSmOff = `${btnSm} border-[#c9cedb] bg-white text-navy hover:border-navy hover:bg-navy-tint`;
const btnSmOn = `${btnSm} border-navy bg-navy text-white`;
const card = "rounded-xl border border-line bg-white p-5";
const field = "min-h-10 rounded-lg border border-[#c9cedb] bg-white px-3 text-[14px] transition-colors duration-150 placeholder:text-[#9aa0aa] focus:border-navy";
const tableWrap = "overflow-x-auto rounded-xl border border-line bg-white";
const th = "bg-[#eef0f5] px-3 py-2.5 text-left text-[12px] font-semibold text-[#444a55]";
const td = "px-3 py-2.5 align-top";

const Badge = ({ children, tone }: { children: React.ReactNode; tone: "ok" | "warn" | "bad" | "info" | "navy" }) => {
  const tones = {
    ok: "bg-[#e5f4ea] text-[#1b6a39]",
    warn: "bg-[#fff1dc] text-[#8a4b00]",
    bad: "bg-brand-tint text-brand-deep",
    info: "bg-[#eceef2] text-[#444a55]",
    navy: "bg-navy-tint text-navy",
  } as const;
  return <span className={`inline-block rounded-md px-2 py-0.5 text-[12px] font-medium leading-5 ${tones[tone]}`}>{children}</span>;
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
  const toDecide = counts ? counts.conflict + counts["needs-check"] : 0; // 직원이 정해야 하는 항목 전체 수
  const hasBar = (step === 2 && !!data) || (step === 3 && !!applied);

  return (
    <div className="flex min-h-screen flex-col">
      {/* 상단 바: 앱 이름 + 단계 탭 */}
      <header className="bg-navy text-white">
        <div className="mx-auto w-full max-w-6xl px-4 pt-4 sm:px-8">
          <div className="flex items-center justify-between gap-3">
            <h1 className="text-[17px] font-semibold tracking-[-0.02em]"><Link href="/" className="hover:underline" title="소개 화면으로">등기 대조·입력 도우미</Link></h1>
            <p className="hidden text-[12px] text-[#aab6dc] sm:block">연습용 가짜(샘플) 데이터로만 동작해요</p>
          </div>
          <nav aria-label="진행 단계" className="mt-3 flex gap-1 overflow-x-auto">
            {STEPS.map((title, i) => {
              const n = (i + 1) as 1 | 2 | 3 | 4;
              const active = n === step;
              const done = n < step;
              const clickable = done && step < 4; // 입력이 끝난 뒤에는 앞 단계로 돌아가지 않는다
              return (
                <button key={title} type="button" aria-current={active ? "step" : undefined} disabled={!clickable}
                  onClick={() => clickable && setStep(n)}
                  className={`flex shrink-0 items-center gap-2 rounded-t-lg px-4 py-2.5 text-[13px] transition-colors duration-150 ${active ? "bg-wash font-semibold text-navy" : done ? "text-white hover:bg-white/10" : "text-[#8fa0cf]"} ${clickable ? "cursor-pointer" : "cursor-default"}`}>
                  <span className={`flex h-5 w-5 items-center justify-center rounded-full text-[11px] ${active ? "bg-brand text-white" : done ? "bg-white/20 text-white" : "border border-[#5e72b0]"}`}>{done ? "✓" : n}</span>
                  {title}
                </button>
              );
            })}
          </nav>
        </div>
      </header>

      <main className={`mx-auto flex w-full max-w-6xl flex-1 flex-col gap-5 px-4 py-6 sm:px-8 ${hasBar ? "pb-28" : "pb-10"}`}>
        {busy && <p role="status" className="rounded-lg border border-[#c9cedb] bg-navy-tint px-4 py-3 text-[14px] text-navy">{busy}</p>}
        {error && <p role="alert" className="rounded-lg border border-brand/40 bg-brand-tint px-4 py-3 text-[14px] text-brand-deep">{error}</p>}
        {notice && <p role="status" className="rounded-lg border border-[#b8dfc6] bg-[#e5f4ea] px-4 py-3 text-[14px] text-[#1b6a39]">{notice}</p>}

        {step === 1 && (
          <section className="flex flex-col gap-4" aria-label="파일 불러오기">
            <div>
              <h2 className="text-[22px] font-semibold">파일 확인</h2>
              <p className="mt-1 text-[14px] text-muted">
                {files?.deployed
                  ? "이 화면은 연습용 가짜 데이터로 보여 주는 시연판이에요. 미리 읽어 둔 결과를 쓰고, 파일 저장은 하지 않아요."
                  : files?.mode === "local" ? (files.pdfCount > 0 ? "이 컴퓨터에서 등기 PDF 안의 글자를 그대로 꺼내 읽어요." : "이 컴퓨터에서 등기 그림을 글자 읽기로 읽어요.") : "미리 읽어 둔 연습용 결과를 써요."}
              </p>
            </div>

            {saved && !files?.deployed && (
              <div className={`${card} flex flex-wrap items-center justify-between gap-3 border-brand/40 bg-brand-tint`}>
                <p className="text-[14px]">이전에 하던 작업이 남아 있어요. <span className="text-muted">({new Date(saved.updatedAt).toLocaleString("ko-KR")} · 승인 {fmt(saved.jobs.filter((j) => j.approved).length)}줄 중 {fmt(saved.jobs.filter((j) => j.approved && j.status === "done").length)}줄 입력 완료)</span></p>
                <button className={btn} onClick={resumeSaved}>이어서 하기</button>
              </div>
            )}

            <div className="grid gap-4 lg:grid-cols-2">
              <div className={card}>
                <h3 className="mb-3 text-[15px] font-semibold">불러올 파일</h3>
                {files ? (
                  <dl className="divide-y divide-line text-[14px]">
                    {([
                      ["기존 엑셀", files.existing.join(", ") || "없음"],
                      ["구청 부과 이력 엑셀", files.city.join(", ") || "없음"],
                      ["전화번호 엑셀", files.phone.join(", ") || "없음 (전화번호 대조는 건너뜀)"],
                      ["등기 파일", files.pdfCount > 0 && !files.deployed ? `PDF ${fmt(files.pdfCount)}건` : `그림 ${fmt(files.imageCount)}장${files.deployed ? " (미리 읽어 둔 결과 사용)" : ""}`],
                    ] as Array<[string, string]>).map(([k, v]) => (
                      <div key={k} className="flex items-baseline justify-between gap-4 py-2"><dt className="text-muted">{k}</dt><dd className="text-right font-medium">{v}</dd></div>
                    ))}
                  </dl>
                ) : <p className="text-[14px] text-muted">파일 목록을 불러오는 중이에요…</p>}
              </div>

              <div className={card}>
                <h3 className="text-[15px] font-semibold">부과 종료일 (일괄)</h3>
                <p className="mt-1 text-[13px] leading-6 text-muted">모든 줄에 쓸 부과 종료일이에요. 이미 소유자가 바뀐 줄은 소유종료일 하루 전까지만 계산해요. 부과 시작일은 구청 마지막 부과 종료일 다음 날(토·일이면 월요일)이에요.</p>
                <label className="mt-3 flex flex-wrap items-center gap-3">
                  <input type="date" value={billingEnd} onChange={(e) => setBillingEnd(e.target.value)} className={field} aria-label="부과 종료일 일괄 입력" />
                  <span className="text-[13px] text-muted">{billingEnd ? "" : "비워 두면 오늘로 계산해요."}</span>
                </label>
              </div>
            </div>

            {files?.llm.available && !files.deployed && (
              <div className={`${card} ${reader === "llm" ? "border-brand" : ""}`}>
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <h3 className="text-[15px] font-semibold">판독 강화</h3>
                    <p className="text-[13px] text-muted">
                      {reader === "llm" ? `켜짐 — 외부 AI(${files.llm.model})가 등기를 한 번 더 읽어요.` : "꺼짐 — 이 컴퓨터 안에서만 읽어요. 파일이 컴퓨터 밖으로 나가지 않아요."}
                    </p>
                  </div>
                  <button
                    type="button" role="switch" aria-checked={reader === "llm"} aria-label="판독 강화"
                    onClick={() => { setReader((r) => (r === "llm" ? "local" : "llm")); setLlmAck(false); }}
                    className={`relative h-7 w-12 shrink-0 rounded-full transition-colors ${reader === "llm" ? "bg-brand" : "bg-[#b3b3b3]"}`}>
                    <span className={`absolute top-0.5 h-6 w-6 rounded-full bg-white shadow transition-all ${reader === "llm" ? "left-[22px]" : "left-0.5"}`} />
                  </button>
                </div>
                {reader === "llm" && (
                  <div role="alert" className="mt-3 rounded-lg border border-brand/40 bg-brand-tint p-4 text-[14px] leading-6 text-brand-deep">
                    <p className="font-semibold">⚠ 정보가 외부로 나갈 수 있어요.</p>
                    <ul className="mt-1 list-disc pl-5">
                      <li>등기 파일(이름·주소·주민등록번호 앞자리 등)이 <strong>외부 서버(OpenAI)로 전송</strong>돼요. 한 번 보내면 되돌릴 수 없어요.</li>
                      <li>사내 규정 확인 전에는 실제 등기·개인정보를 보내면 안 돼요. 지금은 <strong>가짜 샘플 파일(fake-)만</strong> 보내고, 실제 파일은 막혀 있어요.</li>
                      <li>AI는 틀려도 자신 있게 답할 수 있어서 틀린 값이 섞일 수 있어요. 글자가 들어 있는 PDF는 이 컴퓨터에서 읽는 편이 더 정확하고 빨라요.</li>
                      <li>사용 요금이 들어요.</li>
                    </ul>
                    <label className="mt-2 flex items-start gap-2">
                      <input type="checkbox" className="mt-1 h-4 w-4" checked={llmAck} onChange={(e) => setLlmAck(e.target.checked)} />
                      <span>위 내용을 이해했고, 가짜 샘플 파일을 외부로 보내는 데 동의해요.</span>
                    </label>
                  </div>
                )}
              </div>
            )}

            <div className="flex flex-wrap items-center gap-3">
              <button className={`${btnPrimary} min-h-11 px-8 text-[15px]`} onClick={start} disabled={!files || busy !== null || (reader === "llm" && !llmAck)}>검증 시작</button>
              {reader === "llm" && !llmAck && <span className="text-[13px] text-brand-deep">위험 안내에 동의해야 시작할 수 있어요.</span>}
            </div>
          </section>
        )}

        {step === 2 && data && counts && (
          <section className="flex flex-col gap-5" aria-label="대조 결과">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <h2 className="text-[22px] font-semibold">대조 결과</h2>
              <p className="text-[13px] text-muted">등기 {fmt(data.stats.registries)}장 · 엑셀 {fmt(data.stats.rows)}줄 · {data.reader === "llm" ? "판독 강화로" : "이 컴퓨터에서"} 읽음{data.verify.some((v) => v.rounds === 3) ? ` · 3회까지 읽은 등기 ${fmt(data.verify.filter((v) => v.rounds === 3).length)}장` : ""}</p>
            </div>

            <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
              {([
                ["같음", counts.same, "border-[#b3b3b3]", "text-[#8c8c8c]"],
                ["자동 보완", counts.filled, "border-navy", "text-navy"],
                ["충돌 (직접 고르기)", counts.conflict, "border-brand", "text-brand"],
                ["확인 필요", counts["needs-check"], "border-brand-deep", "text-brand-deep"],
              ] as Array<[string, number, string, string]>).map(([label, n, bar, color]) => (
                <div key={label} className={`rounded-xl border border-line border-l-4 bg-white px-4 py-3 ${bar}`}>
                  <div className="text-[12px] text-muted">{label}</div>
                  <div className={`text-[28px] font-semibold leading-tight tracking-[-0.02em] ${color}`}>{fmt(n)}</div>
                </div>
              ))}
            </div>

            <div role="tablist" aria-label="결과 종류" className="flex flex-wrap gap-1 border-b border-line">
              {([["conflict", `충돌 ${fmt(counts.conflict)}`], ["needs-check", `확인 필요 ${fmt(counts["needs-check"])}`], ["filled", `자동 보완 ${fmt(counts.filled)}`], ...(data.phoneMatches.length > 0 ? [["phone", "전화번호"] as [Tab, string]] : []), ["billing", "부과 기간"]] as Array<[Tab, string]>).map(([id, label]) => (
                <button key={id} role="tab" aria-selected={tab === id} onClick={() => setTab(id)}
                  className={`-mb-px border-b-2 px-4 py-2.5 text-[14px] transition-colors duration-150 ${tab === id ? "border-navy font-semibold text-navy" : "border-transparent text-muted hover:text-navy"}`}>{label}</button>
              ))}
            </div>

            {tab === "filled" && (
              <div className={tableWrap}>
                <table className="w-full text-left text-[14px]">
                  <thead><tr><th className={th}>줄</th><th className={th}>항목</th><th className={th}>채운 값</th><th className={th}>출처</th></tr></thead>
                  <tbody>
                    {itemsOf("filled").map((i) => (
                      <tr key={itemKey(i)} className="border-t border-line hover:bg-[#f8f9fc]">
                        <td className={td}>{formatRowId(i.rowId)} {i.isNewRow && <Badge tone="warn">새로 추가된 줄</Badge>}</td>
                        <td className={td}>{FIELD_LABEL[i.field]}</td>
                        <td className={td}>
                          {show(i.registryValue)}
                          {i.registryWins && <div className="mt-0.5 text-[12px] text-muted"><Badge tone="warn">등기 기준으로 고침</Badge> 엑셀에는 {show(i.excelValue)}</div>}
                        </td>
                        <td className={`${td} text-muted`}>{i.source.kind === "city-excel" ? "구청 엑셀" : i.source.kind === "phone-excel" ? "전화번호 엑셀" : `등기 ${i.source.file ?? ""}`} · {i.round}회차</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            {(tab === "conflict" || tab === "needs-check") && (() => {
              const list = itemsOf(tab);
              // 같은 항목(예: 주소)끼리 묶어서 한 번에 정할 수 있게 한다.
              const groups = new Map<FieldKey, ReconcileItem[]>();
              if (tab === "conflict") list.forEach((i) => groups.set(i.field, [...(groups.get(i.field) ?? []), i]));
              const bulk = [...groups.entries()].filter(([, l]) => l.length >= 2);
              return (
                <div className="flex flex-col gap-3">
                  {list.length === 0 && <p className="rounded-xl border border-line bg-white px-4 py-6 text-center text-[14px] text-muted">이 종류의 항목이 없어요.</p>}
                  {bulk.length > 0 && (
                    <div className="rounded-xl border border-line bg-white">
                      <p className="border-b border-line px-4 py-2 text-[12px] font-semibold text-[#444a55]">같은 종류를 한 번에 정하기 <span className="font-normal text-muted">· 정한 뒤에도 항목마다 바꿀 수 있어요</span></p>
                      <ul className="divide-y divide-line">
                        {bulk.map(([f, l]) => (
                          <li key={f} className="flex flex-wrap items-center justify-between gap-2 px-4 py-2">
                            <span className="text-[14px] font-medium">{FIELD_LABEL[f]} <span className="text-brand">{fmt(l.length)}건</span></span>
                            <span className="flex gap-2">
                              <button className={btnSmOff} onClick={() => decideMany(l, "excel")}>모두 엑셀 유지</button>
                              {l.some(canUseRegistry) && <button className={btnSmOff} onClick={() => decideMany(l, "registry")}>모두 {sourceName(l[0])} 사용</button>}
                            </span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                  {list.length > 0 && (
                    <div className={tableWrap}>
                      <table className="w-full min-w-[760px] text-left text-[14px]">
                        <thead><tr><th className={th}>줄 · 항목</th><th className={th}>엑셀 값</th><th className={th}>새 값 (출처)</th><th className={th}>참고</th><th className={th}>선택</th></tr></thead>
                        <tbody>
                          {list.map((i) => (
                            <ItemRow key={itemKey(i)} item={i} decision={decisions[itemKey(i)]} onDecide={(c, v) => decide(i, c, v)}
                              viewFile={!data.deployed && i.source.kind === "registry" ? i.source.file : undefined} />
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              );
            })()}

            {tab === "phone" && (
              <div className="flex flex-col gap-3">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <p className="text-[13px] leading-6 text-muted">전화번호는 등기에 없어서 전화번호 엑셀의 이름·주소와 맞춰 봤어요. 이름과 주소가 모두 같은 기록만 빈칸을 채우고, 나머지는 후보로만 보여 드려요.</p>
                  <button className={btn} disabled={busy !== null} onClick={downloadPhoneSheet}>전화번호 대조표 엑셀 받기</button>
                </div>
                <div className={tableWrap}>
                  <table className="w-full min-w-[820px] text-left text-[14px]">
                    <thead><tr><th className={th}>줄</th><th className={th}>성명</th><th className={th}>주소</th><th className={th}>기존 엑셀 번호</th><th className={th}>전화번호 엑셀 번호</th><th className={th}>근거</th><th className={th}>판단</th></tr></thead>
                    <tbody>
                      {data.phoneMatches.map((p) => (
                        <tr key={formatRowId(p.rowId)} className="border-t border-line hover:bg-[#f8f9fc]">
                          <td className={td}>{formatRowId(p.rowId)}</td><td className={td}>{show(p.name)}</td><td className={td}>{show(p.address)}</td>
                          <td className={td}>{show(p.excelPhone)}</td>
                          <td className={td}>{p.candidates.length > 1 ? p.candidates.join(" / ") : show(p.found)}</td>
                          <td className={`${td} text-muted`}>{PHONE_KIND_TEXT[p.kind]}</td>
                          <td className={td}><Badge tone={p.result === "same" || p.result === "filled" ? "ok" : p.result === "kept" ? "info" : p.result === "conflict" ? "bad" : "warn"}>{PHONE_RESULT_TEXT[p.result]}</Badge></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {tab === "billing" && (
              <div className="flex flex-col gap-3">
                <p className="text-[13px] leading-6 text-muted">부과 종료일은 <strong className="text-ink">{endCap}</strong>이에요. 구청 마지막 부과 종료일 다음 날(토·일이면 다음 월요일)부터 부과 종료일까지, 소유자별로 계산해요.</p>
                <div className={tableWrap}>
                  <table className="w-full min-w-[860px] text-left text-[14px]">
                    <thead><tr><th className={th}>줄</th><th className={th}>성명</th><th className={`${th} text-right`}>점유면적(㎡)</th><th className={th}>소유권이전일</th><th className={th}>소유종료일</th><th className={th}>구청 마지막 부과 종료일</th><th className={th}>부과 기간</th></tr></thead>
                    <tbody>
                      {applied?.rows.map((r) => {
                        const b = billing[formatRowId(r.rowId)];
                        return (
                          <tr key={formatRowId(r.rowId)} className="border-t border-line hover:bg-[#f8f9fc]">
                            <td className={td}>{formatRowId(r.rowId)}</td><td className={td}>{show(r.fields.name)}</td>
                            <td className={`${td} text-right`}>{show(r.fields.occupiedArea)}</td>
                            <td className={td}>{show(r.fields.ownershipDate)}</td><td className={td}>{show(r.fields.ownershipEndDate)}</td>
                            <td className={td}>{show(r.fields.lastBillingEndDate)}</td>
                            <td className={td}>{b?.target ? <span className="font-medium text-navy">{b.start} ~ {b.end}</span> : <span className="text-muted">{b ? BILLING_SKIP_TEXT[b.reason] : ""}</span>}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
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
              <div>
                <h2 className="text-[22px] font-semibold">승인</h2>
                <p className="mt-1 text-[14px] text-muted">사내 프로그램에 입력해도 되는 줄을 고르는 마지막 확인이에요. <strong className="text-ink">승인</strong>하면 아래 &lsquo;입력될 값&rsquo;이 그대로 입력되고, <strong className="text-ink">제외</strong>하면 입력하지 않고 건너뛰어요. 충돌·확인 필요를 아직 못 정한 줄은 승인할 수 없어요.</p>
              </div>

              <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
                <div className="inline-flex rounded-lg border border-[#c9cedb] bg-white p-0.5">
                  {([["all", "전체"], ["changed", "바뀐 줄"], ["new", "새로 추가된 줄"], ["pending", "아직 못 정한 줄"]] as Array<["all" | "changed" | "new" | "pending", string]>).map(([id, label]) => (
                    <button key={id} aria-pressed={approvalView === id} onClick={() => setApprovalView(id)}
                      className={`rounded-md px-3 py-1.5 text-[13px] transition-colors duration-150 ${approvalView === id ? "bg-navy font-semibold text-white" : "text-navy hover:bg-navy-tint"}`}>{label} {fmt(viewCounts[id])}</button>
                  ))}
                </div>
                <input value={approvalQuery} onChange={(e) => setApprovalQuery(e.target.value)} placeholder="이름·지번 검색" aria-label="이름이나 지번으로 검색" maxLength={50} className={`${field} w-48`} />
                <span className="ml-auto flex gap-2">
                  <button className={btn} onClick={() => approveWhere((k) => !isChanged(k))}>바뀌지 않은 줄 모두 승인</button>
                  <button className={btn} onClick={() => approveWhere(() => true)}>정해진 줄 모두 승인</button>
                </span>
              </div>

              <div className={tableWrap}>
                <table className="w-full min-w-[780px] text-left text-[14px]">
                  <thead><tr><th className={th}>줄</th><th className={th}>입력될 값</th><th className={th}>바뀐 내용 · 상태</th><th className={th}>선택</th></tr></thead>
                  <tbody>
                    {shown.length === 0 && <tr><td colSpan={4} className="px-4 py-8 text-center text-muted">이 조건에 맞는 줄이 없어요.</td></tr>}
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
                        <tr key={key} className="border-t border-line align-top hover:bg-[#f8f9fc]">
                          <td className={`${td} whitespace-nowrap font-medium`}>{key}</td>
                          <td className={td}>
                            <dl className="grid grid-cols-[5.5rem_1fr] gap-x-3 gap-y-0.5 text-[14px]">
                              {values.map(([label, f, v]) => (
                                <div key={f} className="contents">
                                  <dt className="text-muted">{label}</dt>
                                  <dd className={ch?.fields.has(f) ? "font-semibold text-navy" : ""}>{show(v)}</dd>
                                </div>
                              ))}
                            </dl>
                            <p className="mt-1 text-[12px] text-muted">부과 기간 · {b?.target ? `${b.start} ~ ${b.end}` : b ? BILLING_SKIP_TEXT[b.reason] : "-"}</p>
                          </td>
                          <td className={td}>
                            <div className="flex flex-col items-start gap-1">
                              {data.newRowKeys.includes(key) && <Badge tone="warn">새로 추가된 줄</Badge>}
                              {data.orphanRowKeys.includes(key) && <Badge tone="warn">엑셀에만 있는 줄</Badge>}
                              {ch?.notes.map((n) => <Badge key={n.text} tone={n.tone}>{n.text}</Badge>)}
                              {!ch?.notes.length && !data.newRowKeys.includes(key) && !data.orphanRowKeys.includes(key) && <span className="text-[12px] text-muted">바뀐 내용 없음</span>}
                              {pending > 0 && <Badge tone="bad">정하지 못한 항목 {pending}개</Badge>}
                            </div>
                          </td>
                          <td className={td}>
                            <div className="flex gap-2">
                              <button className={a === "approved" ? btnSmOn : btnSmOff} aria-pressed={a === "approved"} disabled={pending > 0} onClick={() => setApproval((x) => ({ ...x, [key]: "approved" }))}>{a === "approved" ? "✓ 승인" : "승인"}</button>
                              <button className={a === "excluded" ? `${btnSm} border-[#444a55] bg-[#444a55] text-white` : btnSmOff} aria-pressed={a === "excluded"} onClick={() => setApproval((x) => ({ ...x, [key]: "excluded" }))}>{a === "excluded" ? "✓ 제외" : "제외"}</button>
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              <label className="flex items-center gap-2 text-[12px] text-muted">
                <input type="checkbox" className="h-4 w-4" checked={failTest} onChange={(e) => setFailTest(e.target.checked)} />
                시험용: 승인한 줄 중 앞의 {MAX_CONSECUTIVE_FAILURES + 1}줄을 일부러 실패시키기 (연속 {MAX_CONSECUTIVE_FAILURES}건 실패하면 멈추는지 확인)
              </label>
            </section>
          );
        })()}

        {step === 4 && run && (
          <section className="flex flex-col gap-5" aria-label="입력과 리포트">
            <div>
              <h2 className="text-[22px] font-semibold">입력 · 리포트</h2>
              <p className="mt-1 text-[14px] text-muted">실제 사내 프로그램이 아니라 <strong className="text-ink">모의 입력</strong>이에요. 입력하는 항목은 지번주소·성명·전화번호·주소·주민등록번호 다섯 개뿐이에요.</p>
            </div>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
              {([["입력 완료", run.counts.done, "border-navy", "text-navy"], ["이미 입력해서 건너뜀", run.counts.skipped, "border-[#b3b3b3]", "text-[#8c8c8c]"], ["실패", run.counts.failed, "border-brand", "text-brand"], ["제외", run.counts.excluded, "border-[#b3b3b3]", "text-[#8c8c8c]"], ["멈춰서 못 함", run.counts.notAttempted, "border-brand-deep", "text-brand-deep"]] as Array<[string, number, string, string]>).map(([label, n, bar, color]) => (
                <div key={label} className={`rounded-xl border border-line border-l-4 bg-white px-4 py-3 ${bar}`}>
                  <div className="text-[12px] text-muted">{label}</div>
                  <div className={`text-[28px] font-semibold leading-tight tracking-[-0.02em] ${color}`}>{fmt(n)}</div>
                </div>
              ))}
            </div>
            <p role="status" className={`rounded-lg border px-4 py-3 text-[14px] ${run.compare.matches ? "border-[#b8dfc6] bg-[#e5f4ea] text-[#1b6a39]" : "border-[#f0d3a0] bg-[#fff1dc] text-[#8a4b00]"}`}>
              건수 비교: 승인 {fmt(run.compare.approved)}건 / 입력 완료 {fmt(run.compare.done)}건 — {run.compare.matches ? "모두 입력됐어요." : `${fmt(run.compare.approved - run.compare.done)}건이 아직 입력되지 않았어요.`}
            </p>
            {run.stoppedEarly && (
              <p role="alert" className="rounded-lg border border-brand/40 bg-brand-tint px-4 py-3 text-[14px] text-brand-deep">입력이 계속 실패해서 멈췄어요. 아래 미처리 목록을 확인해 주세요.</p>
            )}
            <div>
              <h3 className="mb-2 text-[15px] font-semibold">미처리 목록 <span className="text-muted">({fmt(run.unprocessed.length)}건)</span></h3>
              {run.unprocessed.length === 0 ? <p className="rounded-xl border border-line bg-white px-4 py-5 text-center text-[14px] text-muted">미처리 줄이 없어요.</p> : (
                <div className={tableWrap}>
                  <table className="w-full text-left text-[14px]">
                    <thead><tr><th className={th}>줄</th><th className={th}>항목</th><th className={th}>사유</th></tr></thead>
                    <tbody>
                      {run.unprocessed.map((u) => (
                        <tr key={formatRowId(u.rowId)} className="border-t border-line">
                          <td className={td}>{formatRowId(u.rowId)}</td><td className={td}>{u.field ? INPUT_FIELD_LABEL[u.field] : "줄 전체"}</td><td className={td}>{u.reason}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
            <div className="flex flex-wrap gap-2">
              <button className={btnPrimary} disabled={busy !== null} onClick={() => guarded("수정본을 만드는 중이에요…", () => download("/api/export", { rows: finalRows }, "수정본.xlsx"))}>수정본 엑셀 받기</button>
              {(data?.phoneMatches.length ?? 0) > 0 && <button className={btn} disabled={busy !== null} onClick={downloadPhoneSheet}>전화번호 대조표 받기</button>}
              <button className={btn} disabled={busy !== null} onClick={() => guarded("리포트를 만드는 중이에요…", () => download("/api/report", { items: data?.items.map((i) => ({ status: i.status })) ?? [], jobs: run.jobs, unprocessed: run.unprocessed }, "결과리포트.xlsx"))}>결과 리포트 받기</button>
              <button className={btn} disabled={run.unprocessed.length === 0 || busy !== null} onClick={resume}>미처리 줄만 이어서 처리</button>
              {!data?.deployed && !files?.deployed && <button className={btn} disabled={busy !== null} onClick={clearAll}>작업 끝내기·자료 지우기</button>}
            </div>
            {run.saved && <p className="text-[12px] text-muted">이 컴퓨터의 작업 폴더(.work)에 진행 상태를 저장했어요. 끝나면 &lsquo;자료 지우기&rsquo;를 눌러 주세요.</p>}
          </section>
        )}
      </main>

      {/* 아래쪽 고정 바: 스크롤해도 "남은 확인 N개"와 다음 단계 버튼이 항상 보인다 */}
      {step === 2 && data && counts && (
        <div className="fixed inset-x-0 bottom-0 z-20 border-t border-line bg-white/95 backdrop-blur">
          <div className="mx-auto flex w-full max-w-6xl flex-wrap items-center justify-between gap-3 px-4 py-3 sm:px-8">
            <p className="text-[14px]" aria-live="polite">
              {unresolvedTotal > 0
                ? <>남은 확인 <strong className="text-[18px] text-brand">{fmt(unresolvedTotal)}개</strong> <span className="text-muted">/ 정해야 할 항목 {fmt(toDecide)}개 · 정함 {fmt(toDecide - unresolvedTotal)}개</span></>
                : <strong className="text-[#1b6a39]">모두 정했어요. 다음 단계로 넘어가세요.</strong>}
            </p>
            <div className="flex gap-2">
              <button className={btn} onClick={() => setStep(1)}>이전</button>
              <button className={btnPrimary} onClick={() => setStep(3)}>다음: 승인하기</button>
            </div>
          </div>
        </div>
      )}
      {step === 3 && applied && (
        <div className="fixed inset-x-0 bottom-0 z-20 border-t border-line bg-white/95 backdrop-blur">
          <div className="mx-auto flex w-full max-w-6xl flex-wrap items-center justify-between gap-3 px-4 py-3 sm:px-8">
            <p className="text-[14px]" aria-live="polite">
              승인 <strong className="text-navy">{fmt(approvedKeys.length)}건</strong> · 제외 <strong>{fmt(excludedKeys.length)}건</strong> · 아직 안 정함 <strong className={rowKeys.length - approvedKeys.length - excludedKeys.length > 0 ? "text-brand" : ""}>{fmt(rowKeys.length - approvedKeys.length - excludedKeys.length)}건</strong>
            </p>
            <div className="flex gap-2">
              <button className={btn} onClick={() => setStep(2)}>이전</button>
              <button className={btnPrimary} disabled={approvedKeys.length === 0 || busy !== null} onClick={startInput}>입력 시작</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/** 충돌·확인 필요 한 항목을 표의 한 줄로 보여 준다. 평소에는 [엑셀 유지] [새 값 사용]만 보이고, 직접 입력·원본 등기는 "더보기"로 펼친다. */
function ItemRow({ item, decision, onDecide, viewFile }: { item: ReconcileItem; decision?: Decision; onDecide: (choice: DecisionChoice, input?: string) => void; viewFile?: string }) {
  const [text, setText] = useState("");
  const [more, setMore] = useState(false);
  const [open, setOpen] = useState(false);
  const resolved = isResolved(item, decision ? { [itemKey(item)]: decision } : {});
  const canKeep = item.excelValue != null;
  const canRegistry = canUseRegistry(item);
  const hint = item.status === "conflict" ? conflictHint(item.field, item.excelValue, item.registryValue) : null;
  const choice = decision?.choice;
  const confidenceText = item.confidence === undefined ? null
    : item.source.file?.toLowerCase().endsWith(".pdf")
      ? item.confidence >= 90 ? "PDF 글자 그대로" : "PDF 글자가 이상해서 믿기 어려워요"
      : `확신도 ${Math.round(item.confidence)}%`;
  return (
    <>
      <tr className={`border-t border-line align-top ${resolved ? "bg-white" : "bg-[#fff8fa]"}`}>
        <td className={`${td} border-l-4 ${resolved ? "border-l-[#b8dfc6]" : item.status === "conflict" ? "border-l-brand" : "border-l-brand-deep"}`}>
          <div className="font-medium">{formatRowId(item.rowId)}</div>
          <div className="text-[12px] text-muted">{FIELD_LABEL[item.field]}</div>
          {item.isNewRow && <div className="mt-1"><Badge tone="warn">새로 추가된 줄</Badge></div>}
        </td>
        <td className={td}>{show(item.excelValue)}</td>
        <td className={td}>
          <div className="font-medium text-navy">{show(item.registryValue)}</div>
          <div className="text-[12px] text-muted">{sourceName(item)}{confidenceText ? ` · ${confidenceText}` : ""}</div>
        </td>
        <td className={`${td} max-w-[220px] text-[12px] leading-5 text-muted`}>
          {item.note}
          {hint && <div className="mt-1 text-[#8a4b00]">참고: {hint}</div>}
        </td>
        <td className={td}>
          <div className="flex flex-wrap items-center gap-1.5">
            {canKeep && <button className={choice === "excel" ? btnSmOn : btnSmOff} aria-pressed={choice === "excel"} onClick={() => onDecide("excel")}>{choice === "excel" ? "✓ " : ""}엑셀 유지</button>}
            {canRegistry && <button className={choice === "registry" ? btnSmOn : btnSmOff} aria-pressed={choice === "registry"} onClick={() => onDecide("registry")}>{choice === "registry" ? "✓ " : ""}{item.registryValue === null ? "비움(등기 기준)" : `${sourceName(item)} 사용`}</button>}
            <button className={`${btnSm} border-transparent text-muted hover:text-navy`} aria-expanded={more} onClick={() => setMore((m) => !m)}>{more ? "접기" : "더보기"}</button>
          </div>
          {choice === "input" && <p className="mt-1 text-[12px] text-navy">✓ 직접 입력: {decision?.inputValue}</p>}
        </td>
      </tr>
      {more && (
        <tr className="border-t border-line bg-[#f8f9fc]">
          <td colSpan={5} className="px-4 py-3">
            <div className="flex flex-wrap items-center gap-2">
              <label className="flex items-center gap-2 text-[13px]">
                <span className="text-muted">직접 입력</span>
                <input value={text} onChange={(e) => setText(e.target.value)} placeholder="올바른 값" maxLength={200} className={`${field} min-h-9 w-64`} />
              </label>
              <button className={btnSmOff} disabled={text.trim() === ""} onClick={() => onDecide("input", text.trim())}>이 값으로 정하기</button>
              {viewFile && <button className={btnSmOff} aria-expanded={open} onClick={() => setOpen((o) => !o)}>{open ? "원본 등기 닫기" : "원본 등기 보기"}</button>}
            </div>
            {open && viewFile && (
              <div className="mt-3">
                <p className="mb-1 text-[12px] text-muted">원본 파일: {viewFile} (갑구 소유권 사항을 찾아보세요)</p>
                {viewFile.toLowerCase().endsWith(".pdf")
                  ? <iframe title={`원본 등기 ${viewFile}`} src={`/api/source?file=${encodeURIComponent(viewFile)}`} className="h-[560px] w-full rounded-lg border border-line bg-white" />
                  // eslint-disable-next-line @next/next/no-img-element
                  : <img alt={`원본 등기 ${viewFile}`} src={`/api/source?file=${encodeURIComponent(viewFile)}`} className="max-h-[560px] w-full rounded-lg border border-line bg-white object-contain" />}
              </div>
            )}
          </td>
        </tr>
      )}
    </>
  );
}
