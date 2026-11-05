// Design Ref: §2 "주요 데이터" — 앱 전체가 함께 쓰는 데이터 모양(타입)만 정의한다. 동작 코드는 넣지 않는다.
// Plan: PLAN.md 2번. 용어는 DESIGN.md 0장(용어 표)을 따른다.

// ───────────────────────── 기본 약속 ─────────────────────────

/** 날짜는 항상 `YYYY-MM-DD` 글자로 다룬다. 왜: 표기 차이(점·앞자리 0)를 한 가지로 통일하기 위해. */
export type IsoDate = string;

/** 엑셀 가로 항목 10개의 이름표 (PRD 6장). */
export type FieldKey =
  | "name" // 성명
  | "phone" // 전화번호
  | "address" // 주소
  | "rrn" // 주민등록번호
  | "occupiedArea" // 점유면적(㎡) — 구청 엑셀에서 옮기기만 함
  | "ownershipDate" // 소유권이전일
  | "ownershipEndDate" // 소유종료일 (현재 소유자는 비움)
  | "lastBillingEndDate" // 구청 마지막 부과 종료일
  | "billingStartDate" // 부과 시작일
  | "billingEndDate"; // 부과 종료일

/** 사내 프로그램에 입력하는 5개 항목 (PRD 5장 must 2). 이 밖의 항목은 입력하지 않는다. */
export type InputField = "lotAddress" | "name" | "phone" | "address" | "rrn";

/** 값이 없으면 null. 왜: 빈칸(엑셀 빈칸)과 "0"·"" 같은 값을 구분하기 위해. */
export type Nullable<T> = T | null;

// ───────────────────────── 줄 번호 ─────────────────────────

/**
 * 엑셀 한 줄을 가리키는 번호. 지번주소 + 소유자 순번.
 * 왜: 같은 지번에 소유자가 여럿이면 줄이 여러 개라, 지번주소만으로는 구분이 안 된다.
 * 화면 표기 예: `XX동 27-1 (1)`, `XX동 27-1 (2)`.
 */
export interface RowId {
  /** 지번주소 (예: "XX동 27-1") */
  lotAddress: string;
  /** 같은 지번 안에서 소유자 순번 (1부터) */
  ownerIndex: number;
}

// ───────────────────────── 출처·근거 ─────────────────────────

/** 값이 어디서 왔는지. 왜: 모든 자동 변경에 출처와 근거를 남겨야 한다 (CLAUDE.md 6장). */
export type SourceKind =
  | "registry" // 등기에서 읽음
  | "excel" // 기존 엑셀
  | "city-excel" // 구청 엑셀
  | "phone-excel" // 전화번호 엑셀
  | "staff-choice" // 직원이 충돌에서 고름
  | "staff-input"; // 직원이 직접 입력

export interface Source {
  kind: SourceKind;
  /** 어느 파일인지 (파일 이름만, 경로 X) */
  file?: string;
  /** 몇 회차에 읽었는지 */
  round?: number;
  /** 근거 설명 (개인정보는 넣지 않는다) */
  note?: string;
}

// ───────────────────────── 엑셀 ─────────────────────────

/** 기존 엑셀의 한 줄. 빈칸은 null. */
export interface ExcelRow {
  rowId: RowId;
  fields: Record<FieldKey, Nullable<string>>;
}

/** 구청 부과 이력 한 건 (지번·소유자별 부과 시작일~종료일). */
export interface BillingHistory {
  lotAddress: string;
  ownerName: string;
  startDate: IsoDate;
  endDate: IsoDate;
  /** 점유면적(㎡). 구청 엑셀에 있는 값 그대로 */
  occupiedArea?: Nullable<string>;
}

// ───────────────────────── 등기 읽기 ─────────────────────────

/** 읽은 값과 그 확신도. 확신도는 0~100 (Tesseract.js 점수 기준). */
export interface ReadValue {
  value: Nullable<string>;
  /** 항목 확신도 = 그 항목 단어들의 확신도 중 가장 낮은 값 */
  confidence: number;
}

/** 등기 갑구의 소유자 한 명. */
export interface RegistryOwner {
  name: ReadValue;
  rrn: ReadValue;
  address: ReadValue;
  ownershipDate: ReadValue;
  /** 현재 소유자는 value가 null */
  ownershipEndDate: ReadValue;
}

/** 등기 그림 한 장을 읽은 결과. */
export interface RegistryReading {
  /** 어느 파일에서 읽었는지 (파일 이름만) */
  sourceFile: string;
  lotAddress: ReadValue;
  owners: RegistryOwner[];
}

/** 회차마다 읽는 방법을 바꾼다: 원본 → 흑백·선명 → 확대. */
export type ReadMethod = "original" | "sharpened" | "enlarged";

/** 같은 그림을 한 회차 읽은 결과. 반복 검증에서 회차끼리 비교한다. */
export interface RoundReading {
  round: number;
  method: ReadMethod;
  reading: RegistryReading;
}

// ───────────────────────── 대조 ─────────────────────────

/**
 * 대조 결과 상태.
 * - same: 표기 차이만 있고 같은 값
 * - filled: 엑셀 빈칸을 등기로 채움(새 소유자 줄 추가 포함)
 * - conflict: 값이 다름 → 직원이 고른다
 * - needs-check: 확신도 90% 미만, 3회 후에도 달라짐, 짝이 안 맞음
 */
export type ReconcileStatus = "same" | "filled" | "conflict" | "needs-check";

/** 대조 항목 하나. */
export interface ReconcileItem {
  rowId: RowId;
  field: FieldKey;
  excelValue: Nullable<string>;
  registryValue: Nullable<string>;
  status: ReconcileStatus;
  source: Source;
  /** 몇 회차까지 돌려서 나온 결과인지 */
  round: number;
  /** 등기에서 읽은 값의 확신도(0~100). 등기 기준 항목일 때만 있다. */
  confidence?: number;
  /** 사람이 읽을 쉬운 설명 (개인정보는 넣지 않는다) */
  note?: string;
  /** 엑셀에 없어서 새로 추가된 소유자 줄이면 true */
  isNewRow?: boolean;
  /** 엑셀 값이 등기와 달라서 등기 기준으로 고친 항목이면 true (소유기간만 해당). status는 "filled". */
  registryWins?: boolean;
}

// ───────────────────────── 모의 입력 ─────────────────────────

/** 입력 작업 상태 (건너뜀 = 이미 입력해서 다시 넣지 않은 것). */
export type InputStatus = "pending" | "done" | "skipped" | "failed" | "excluded";

/** 입력 작업 한 줄. */
export interface InputJob {
  rowId: RowId;
  /** 직원이 승인했는지 */
  approved: boolean;
  status: InputStatus;
  /** 실패·제외·건너뜀 사유 (개인정보는 넣지 않는다) */
  reason: Nullable<string>;
}

/**
 * 승인된 입력 작업.
 * 왜: 입력 함수는 이 타입만 받게 해서, 승인 없이 입력하는 길을 코드 모양으로 막는다 (DESIGN.md 2장 안전 장치).
 */
export type ApprovedInputJob = InputJob & { approved: true };

/** 입력이 막혀 나중에 이어서 처리할 항목 (미처리 목록의 한 줄). */
export interface UnprocessedItem {
  rowId: RowId;
  /** 막힌 항목 (줄 전체가 막혔으면 null) */
  field: Nullable<InputField>;
  reason: string;
}
