import { listInputFiles } from "@/lib/server-input";

// 화면에 보여줄 "불러올 수 있는 파일 목록". 서버가 실제 폴더를 읽어 만든 목록만 돌려준다.
export async function GET(request: Request) {
  request.headers.get("host"); // 요청 때마다 새로 계산하도록 요청 정보를 읽는다
  return Response.json(await listInputFiles());
}
