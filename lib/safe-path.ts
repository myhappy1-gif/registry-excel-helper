// Design Ref: §9.2 — 파일 이름에 `../.env` 같은 경로를 넣어 다른 폴더를 엿보지 못하게 한다(경로 탈출 방지).
// 서버가 폴더 안의 실제 파일 목록을 먼저 만들고, 그 목록에 있는 이름만 받는다. 경로를 합친 뒤에도 폴더 안인지 한 번 더 확인한다.

import path from "node:path";
import { ERROR_TEXT, UserError } from "./errors";

/** 허용 목록에 있는 이름만 통과시킨다. */
export function pickAllowed(name: string, allowed: readonly string[]): string {
  if (typeof name !== "string" || !allowed.includes(name)) throw new UserError("bad-file-name", ERROR_TEXT.badFileName);
  return name;
}

/** 폴더 안의 파일 경로만 만든다. 이름에 경로 문자가 있거나 결과가 폴더 밖이면 거부한다. */
export function resolveInside(baseDir: string, fileName: string): string {
  const base = path.resolve(baseDir);
  const plain = typeof fileName === "string" && fileName === path.basename(fileName) && !/[\\/]|\.\./.test(fileName);
  if (!plain || fileName === "") throw new UserError("bad-file-name", ERROR_TEXT.badFileName);
  const full = path.resolve(base, fileName);
  const relative = path.relative(base, full);
  if (relative.startsWith("..") || path.isAbsolute(relative)) throw new UserError("bad-file-name", ERROR_TEXT.badFileName);
  return full;
}
