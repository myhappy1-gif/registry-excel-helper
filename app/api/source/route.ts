import { promises as fs } from "node:fs";
import path from "node:path";
import { isDeployed } from "@/lib/runtime-mode";
import { pickAllowed, resolveInside } from "@/lib/safe-path";
import { toErrorResponse } from "@/lib/errors";

// 충돌 항목 옆에서 원본 등기(PDF·그림)를 바로 열어 볼 수 있게 한다. 이 컴퓨터에서만 동작하고 배포판에서는 막는다.
// 파일 이름은 sample-data 안의 실제 파일 목록에 있는 것만 받는다(경로 탈출 방지).
const SAMPLE_DIR = path.resolve(process.cwd(), "sample-data");
const IMAGE_DIR = path.join(SAMPLE_DIR, "images");
const PDF_DIR = path.join(SAMPLE_DIR, "pdfs");

async function listDir(dir: string, pattern: RegExp): Promise<string[]> {
  try {
    return (await fs.readdir(dir)).filter((n) => pattern.test(n));
  } catch {
    return [];
  }
}

export async function GET(request: Request) {
  try {
    if (isDeployed()) return new Response("시연판에서는 원본 등기를 열 수 없어요.", { status: 404 });
    const name = new URL(request.url).searchParams.get("file") ?? "";
    const pdfs = await listDir(PDF_DIR, /\.pdf$/i);
    const images = await listDir(IMAGE_DIR, /^fake-.*\.png$/i);
    const isPdf = pdfs.includes(name);
    if (!isPdf && !images.includes(name)) return new Response("파일을 찾을 수 없어요.", { status: 404 });
    const file = resolveInside(isPdf ? PDF_DIR : IMAGE_DIR, pickAllowed(name, isPdf ? pdfs : images));
    return new Response(new Uint8Array(await fs.readFile(file)), {
      headers: { "Content-Type": isPdf ? "application/pdf" : "image/png", "Content-Disposition": "inline", "Cache-Control": "no-store" },
    });
  } catch (error) {
    const { status, body } = toErrorResponse(error);
    return Response.json(body, { status });
  }
}
