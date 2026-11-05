// Design Ref: §9.3·9.6 — 배포(Vercel)판은 가짜 데이터 시연 전용이다. 파일 쓰기·글자 읽기·모의 입력 저장 입구를 코드에서 막는다.
// `OCR_MODE`가 없으면 샘플 모드가 기본이다.

import path from "node:path";
import { ERROR_TEXT, UserError } from "./errors";

/** Vercel 같은 공개 배포 환경인지. */
export const isDeployed = (): boolean => Boolean(process.env.VERCEL) || process.env.DEMO_ONLY === "1";

/** 글자 읽기 방식. 배포판에서는 항상 sample. */
export function ocrMode(): "sample" | "local" {
  return process.env.OCR_MODE === "local" && !isDeployed() ? "local" : "sample";
}

/** 작업 상태·임시 파일 폴더 (이 컴퓨터에서만). */
// 왜 turbopackIgnore: 작업 폴더 이름이 환경 변수로 바뀔 수 있어 빌드 도구가 "프로젝트 전체를 배포물에 넣어야 한다"고 오해하기 때문. 이 폴더는 이 컴퓨터에서만 쓰고 배포판에서는 쓰지 않는다.
export const workDir = (): string => path.resolve(/* turbopackIgnore: true */ process.cwd(), process.env.WORK_DIR ?? ".work");

/** 수정본·리포트를 저장하는 폴더. */
export const outputDir = (): string => path.resolve(process.cwd(), "output");

/** 파일을 쓰는 기능 앞에서 호출한다. 배포판이면 쉬운 안내와 함께 거부한다. */
export function assertWritable(): void {
  if (isDeployed()) throw new UserError("deployed-readonly", ERROR_TEXT.deployedReadonly, 403);
}
