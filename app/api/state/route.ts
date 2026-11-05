import { loadState } from "@/lib/state-store";

// 이전에 하던 작업이 남아 있는지 확인한다(이어서 하기). 배포판에서는 항상 없음.
export async function GET(request: Request) {
  request.headers.get("host"); // 요청 때마다 새로 읽도록 요청 정보를 읽는다
  return Response.json({ state: await loadState() });
}
