// Design Ref: §5 서버 입구와 오류 / §9.7 — 값을 바꾸는 입구(POST)는 같은 사이트에서 온 요청만 받고, 본문 크기를 제한하며, 오류는 쉬운 말로 돌려준다.

import { ERROR_TEXT, UserError, toErrorResponse } from "./errors";
import { isSameOrigin } from "./origin-check";
import { asObject } from "./validate";

const MAX_BODY_BYTES = 2_000_000;

/** POST 입구 공통 처리. handler가 Response를 돌려주면 그대로, 값을 돌려주면 JSON으로 보낸다. */
export async function handlePost(request: Request, handler: (body: Record<string, unknown>) => Promise<unknown>): Promise<Response> {
  try {
    if (!isSameOrigin(request)) throw new UserError("forbidden", ERROR_TEXT.forbidden, 403);
    const length = Number(request.headers.get("content-length") ?? "0");
    if (length > MAX_BODY_BYTES) throw new UserError("bad-request", "보낸 내용이 너무 커요.", 413);
    const raw = await request.text();
    if (raw.length > MAX_BODY_BYTES) throw new UserError("bad-request", "보낸 내용이 너무 커요.", 413);
    let parsed: unknown = {};
    if (raw.trim()) {
      try {
        parsed = JSON.parse(raw);
      } catch {
        throw new UserError("bad-request", "보낸 내용을 읽을 수 없어요.");
      }
    }
    const result = await handler(asObject(parsed));
    return result instanceof Response ? result : Response.json(result);
  } catch (error) {
    const { status, body } = toErrorResponse(error);
    return Response.json(body, { status });
  }
}

/** 엑셀 내려받기 응답. 한글 파일 이름도 깨지지 않게 보낸다. */
export function xlsxResponse(buffer: Buffer, fileName: string): Response {
  return new Response(new Uint8Array(buffer), {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(fileName)}`,
      "Cache-Control": "no-store",
    },
  });
}
