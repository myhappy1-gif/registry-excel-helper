// Design Ref: §5 서버 입구와 오류 — 직원에게는 어려운 오류 대신 쉬운 한국어 안내를 보여준다. 내부 정보(경로·시스템 오류)는 드러내지 않는다.

export type UserErrorCode =
  | "bad-request"
  | "forbidden"
  | "missing-column"
  | "overwrite-original"
  | "bad-file-name"
  | "unreadable-image"
  | "deployed-readonly"
  | "llm-error";

/** 직원에게 그대로 보여줘도 되는 오류. message는 쉬운 말로 쓴다. */
export class UserError extends Error {
  constructor(
    public readonly code: UserErrorCode,
    message: string,
    public readonly status: number = 400,
  ) {
    super(message);
    this.name = "UserError";
  }
}

export const ERROR_TEXT = {
  missingColumn: (column: string) => `엑셀에 '${column}' 열이 없어요. 열 이름을 확인해 주세요.`,
  overwriteOriginal: "원본은 바꾸지 않아요. 새 이름으로 저장할게요.",
  badFileName: "파일 이름이 올바르지 않아요. 목록에 있는 파일만 고를 수 있어요.",
  unreadableImage: "이 등기 그림은 글자를 읽을 수 없어요. '확인 필요'에 넣어 두었습니다.",
  deployedReadonly: "공개된 시연 화면에서는 이 기능을 쓸 수 없어요. 이 컴퓨터에서 직접 실행해 주세요.",
  forbidden: "허용되지 않은 요청이에요.",
  consecutiveFailures: "입력이 계속 실패해서 멈췄어요. 미처리 목록을 확인해 주세요.",
} as const;

/** 서버에서 잡은 오류를 화면에 보낼 응답으로 바꾼다. 알 수 없는 오류는 자세한 내용을 숨긴다. */
export function toErrorResponse(error: unknown): { status: number; body: { error: string; code: string } } {
  if (error instanceof UserError) return { status: error.status, body: { error: error.message, code: error.code } };
  return { status: 500, body: { error: "처리 중에 문제가 생겼어요. 잠시 뒤에 다시 시도해 주세요.", code: "internal" } };
}
