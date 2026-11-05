// 등기 PDF·그림을 AI(LLM)에게 읽히는 방법. 이 컴퓨터 안에서 읽는 방법(pdfjs·Tesseract)과 직원이 골라 쓸 수 있다.
// 주의: 이 방법은 등기 파일을 **외부 서버(OpenAI)로 보낸다.** 그래서
//  - 기본은 꺼져 있고, 직원이 화면에서 직접 골라야만 쓴다.
//  - 사내 규정 확인 전까지는 가짜 샘플 파일(이름이 `fake-`로 시작)만 보낸다(LLM_ALLOW_REAL=1이면 해제).
//  - 시연(배포)판에서는 항상 막는다.
// 키는 `.env`의 OPENAI_API_KEY에서만 읽고, 로그·화면·오류 문구에 절대 내보내지 않는다.
// 새 라이브러리 없이 fetch로 호출한다. 서버에서만 쓴다.

import { promises as fs } from "node:fs";
import { parseDate } from "../dates";
import { UserError } from "../errors";
import { emptyReading } from "../ocr/parse-fields";
import { lotFromFileName } from "../pdf/parse-registry";
import { isDeployed } from "../runtime-mode";
import type { ReadValue, RegistryOwner, RegistryReading } from "../types";
import { diffPaths } from "../verify-loop";

const API_URL = "https://api.openai.com/v1/chat/completions";
/** 같은 파일을 읽는 기본 횟수. 두 번 읽어 값이 다르면 세 번째까지 읽고, 그래도 다른 항목은 "확인 필요"가 된다. */
const BASE_ROUNDS = 2;
/**
 * AI가 읽고 모양 검사를 통과한 값에 주는 확신도. AI는 틀려도 자신 있게 답하므로 PDF 글자(100)보다 낮게 두고,
 * 두 번 읽어 값이 다르면 반복 검증이 "확인 필요"로 돌린다.
 */
const LLM_CONFIDENCE = 95;
const TIMEOUT_MS = 120_000;

export const llmModel = (): string => process.env.LLM_MODEL?.trim() || "gpt-4o";
/** 이 컴퓨터에서 키가 등록돼 있어 AI로 읽을 수 있는지. (키 값은 어디에도 내보내지 않는다) */
export const llmAvailable = (): boolean => !isDeployed() && Boolean(process.env.OPENAI_API_KEY?.trim());

const SYSTEM_PROMPT = [
  "너는 한국 부동산 등기사항증명서(건물) 읽기 도우미다. 주어진 등기에서 갑구(소유권에 관한 사항)만 읽어 JSON으로 답한다.",
  "- 소유권보존·소유권이전 등기만 소유자로 본다. 가등기, 압류, 말소, 을구(근저당권 등)의 이름은 소유자가 아니므로 넣지 않는다.",
  "- 같은 등기에 공유자가 여럿이면 소유자를 각각 따로 적는다.",
  "- ownershipDate는 그 소유자의 소유권 등기 접수일(YYYY-MM-DD). ownershipEndDate는 다음 소유권 등기의 접수일이고, 현재 소유자면 null이다.",
  "- rrn은 보이는 그대로 적는다. 뒷자리가 *로 가려져 있으면 *를 그대로 둔다. 절대 뒷자리를 짐작해 채우지 않는다.",
  "- address는 소유자(권리자)의 주소다. lotAddress는 건물이 있는 동·리와 번지만 적는다(예: 하늘동 4, 가온동 16-8).",
  "- 글자가 흐리거나 확실하지 않은 값은 지어내지 말고 null로 둔다.",
].join("\n");

const strOrNull = { type: ["string", "null"] } as const;
const SCHEMA = {
  name: "registry_reading",
  strict: true,
  schema: {
    type: "object",
    additionalProperties: false,
    required: ["lotAddress", "owners"],
    properties: {
      lotAddress: strOrNull,
      owners: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          required: ["name", "rrn", "address", "ownershipDate", "ownershipEndDate"],
          properties: { name: strOrNull, rrn: strOrNull, address: strOrNull, ownershipDate: strOrNull, ownershipEndDate: strOrNull },
        },
      },
    },
  },
} as const;

interface RawLlmOwner {
  name: string | null;
  rrn: string | null;
  address: string | null;
  ownershipDate: string | null;
  ownershipEndDate: string | null;
}
interface RawLlmReading {
  lotAddress: string | null;
  owners: RawLlmOwner[];
}

const squash = (s: string | null): string => (s ?? "").replace(/\s+/g, "");
const ok = (value: string | null): ReadValue => ({ value, confidence: LLM_CONFIDENCE });
const bad = (value: string | null): ReadValue => ({ value, confidence: 0 });

// ── 모양 검사: AI가 지어낸 값(이름이 아닌 글자, 없는 날짜 등)을 "확인 필요"로 돌린다. ──
const validName = (v: string | null) => /^[가-힣]{2,5}$/.test(squash(v));
const validAddress = (v: string | null) => squash(v).length >= 6;
const validLot = (v: string | null) => /^[가-힣0-9]+(?:동|리|가)산?\d+(?:-\d+)?$/.test(squash(v));
function validRrn(v: string | null): boolean {
  const m = /^(\d{2})(\d{2})(\d{2})-(\d{7}|\d\*{6}|\*{7})$/.exec(squash(v));
  return m !== null && Number(m[2]) >= 1 && Number(m[2]) <= 12 && Number(m[3]) >= 1 && Number(m[3]) <= 31;
}

/** AI가 돌려준 글자를 앱의 읽기 결과 모양으로 바꾸고 모양을 검사한다. 순수 함수라 시험할 수 있다. */
export function toReading(raw: RawLlmReading, sourceFile: string): RegistryReading {
  const hint = lotFromFileName(sourceFile);
  const lot = hint ?? (raw.lotAddress ? squash(raw.lotAddress).replace(/^(.*?(?:동|리|가))/, "$1 ") : null);
  const lotValue: ReadValue = hint ? ok(hint) : lot && validLot(lot) ? ok(lot.trim()) : bad(lot);

  let lastDate: string | null = null;
  const owners: RegistryOwner[] = raw.owners.map((o) => {
    const start = o.ownershipDate ? parseDate(o.ownershipDate) : null;
    const end = o.ownershipEndDate ? parseDate(o.ownershipEndDate) : null;
    const startOk = start !== null && (lastDate === null || start >= lastDate);
    if (start) lastDate = start;
    return {
      name: validName(o.name) ? ok(squash(o.name)) : bad(o.name),
      rrn: validRrn(o.rrn) ? ok(squash(o.rrn)) : bad(o.rrn),
      address: validAddress(o.address) ? ok((o.address ?? "").trim()) : bad(o.address),
      ownershipDate: startOk ? ok(start) : bad(start ?? o.ownershipDate),
      // 비어 있음 = 현재 소유자. 값이 있는데 날짜로 읽히지 않으면 믿지 않는다.
      ownershipEndDate: o.ownershipEndDate == null || o.ownershipEndDate === "" ? ok(null) : end ? ok(end) : bad(o.ownershipEndDate),
    };
  });
  return { sourceFile, lotAddress: lotValue, owners };
}

function apiError(status: number): UserError {
  if (status === 401 || status === 403) return new UserError("llm-error", "AI 키가 맞지 않거나 사용 권한이 없어요. `.env`의 OPENAI_API_KEY를 확인해 주세요.", 502);
  if (status === 429) return new UserError("llm-error", "AI 사용 한도를 넘었거나 요청이 너무 많아요. 잠시 뒤에 다시 하거나 '이 컴퓨터에서 읽기'를 골라 주세요.", 502);
  return new UserError("llm-error", "AI 서버에서 읽는 데 실패했어요. '이 컴퓨터에서 읽기'로 바꿔 보세요.", 502);
}

/** 파일 한 개를 AI에게 한 번 읽힌다. 읽을 수 없는 파일은 빈 결과(= 확인 필요), 키·한도 문제는 직원에게 알린다. */
async function readOnce(file: Buffer, sourceFile: string): Promise<RegistryReading> {
  const key = process.env.OPENAI_API_KEY?.trim();
  if (!key) throw new UserError("llm-error", "AI 키가 등록돼 있지 않아요. `.env`에 OPENAI_API_KEY를 넣어 주세요.", 400);

  const b64 = file.toString("base64");
  const isPdf = sourceFile.toLowerCase().endsWith(".pdf");
  const part = isPdf
    ? { type: "file", file: { filename: "registry.pdf", file_data: `data:application/pdf;base64,${b64}` } }
    : { type: "image_url", image_url: { url: `data:image/png;base64,${b64}`, detail: "high" } };

  let res: Response;
  try {
    res = await fetch(API_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
      body: JSON.stringify({
        model: llmModel(),
        temperature: 0,
        response_format: { type: "json_schema", json_schema: SCHEMA },
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          { role: "user", content: [{ type: "text", text: "이 등기에서 소유자와 소유 기간을 읽어 주세요." }, part] },
        ],
      }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch {
    return emptyReading(sourceFile); // 연결 실패·시간 초과: 이 파일만 확인 필요로 보낸다
  }
  if (res.status === 401 || res.status === 403 || res.status === 429) throw apiError(res.status);
  if (!res.ok) return emptyReading(sourceFile);

  try {
    const data = (await res.json()) as { choices?: Array<{ message?: { content?: string | null; refusal?: string | null } }> };
    const content = data.choices?.[0]?.message?.content;
    if (!content) return emptyReading(sourceFile);
    const raw = JSON.parse(content) as RawLlmReading;
    if (!Array.isArray(raw.owners)) return emptyReading(sourceFile);
    return toReading(raw, sourceFile);
  } catch {
    return emptyReading(sourceFile);
  }
}

/** 파일 하나를 회차별로 읽는다: 기본 2회, 값이 다르면 3회까지. (verify-loop에 그대로 넘긴다) */
export async function readRegistryRoundsLlm(filePath: string, sourceFile: string): Promise<RegistryReading[]> {
  if (!llmAvailable()) throw new UserError("llm-error", "이 화면에서는 AI로 읽을 수 없어요.", 400);
  // 사내 규정 확인 전에는 실제 등기를 외부로 보내지 않는다: 가짜 샘플(fake-)만 허용한다.
  if (!sourceFile.startsWith("fake-") && process.env.LLM_ALLOW_REAL !== "1") {
    throw new UserError("llm-error", "AI로 읽기는 지금 가짜 샘플 파일(이름이 fake-로 시작)만 쓸 수 있어요. 실제 등기는 외부로 보내지 않아요.", 400);
  }
  let file: Buffer;
  try {
    file = await fs.readFile(filePath);
  } catch {
    return [emptyReading(sourceFile)];
  }
  const rounds: RegistryReading[] = [];
  for (let i = 0; i < BASE_ROUNDS; i++) rounds.push(await readOnce(file, sourceFile));
  if (diffPaths(rounds[0], rounds[1]).length > 0) rounds.push(await readOnce(file, sourceFile));
  return rounds;
}

/** 여러 파일을 몇 개씩 동시에 읽는다(300건을 한 줄로 읽으면 너무 오래 걸린다). */
export async function readManyLlm(
  files: Array<{ path: string; name: string }>,
  concurrency = 4,
): Promise<Map<string, RegistryReading[]>> {
  const out = new Map<string, RegistryReading[]>();
  let next = 0;
  let failure: unknown = null;
  const worker = async () => {
    while (next < files.length && !failure) {
      const f = files[next++];
      try {
        out.set(f.name, await readRegistryRoundsLlm(f.path, f.name));
      } catch (e) {
        failure = e;
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(concurrency, files.length) }, worker));
  if (failure) throw failure;
  return out;
}
