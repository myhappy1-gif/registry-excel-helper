import { handlePost } from "@/lib/api";
import { assertWritable } from "@/lib/runtime-mode";
import { clearWorkFiles } from "@/lib/state-store";

// [작업 끝내기·자료 지우기]: 작업 상태와 모의 입력 기록을 지운다. 배포판에서는 지울 자료가 없어 거부한다.
export async function POST(request: Request) {
  return handlePost(request, async () => {
    assertWritable();
    return clearWorkFiles();
  });
}
