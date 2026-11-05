import { handlePost } from "@/lib/api";
import { todayKst } from "@/lib/dates";
import { runPipeline } from "@/lib/pipeline";
import { isDeployed } from "@/lib/runtime-mode";
import { demoMaskPipeline } from "@/lib/mask";
import { loadInput } from "@/lib/server-input";
import { parseOptionalName } from "@/lib/validate";

// 검증 시작: 등기 읽기(회차 반복) → 대조까지 한 번에 돌려 결과를 돌려준다.
export async function POST(request: Request) {
  return handlePost(request, async (body) => {
    const { input, mode, reader } = await loadInput({
      existing: parseOptionalName(body.existing),
      city: parseOptionalName(body.city),
      reader: body.reader === "llm" ? "llm" : "local",
    });
    const result = runPipeline(input);
    // 공개 시연판은 이름·주민번호를 가려서 내보낸다(이 컴퓨터에서 쓸 때는 그대로).
    const shown = isDeployed() ? demoMaskPipeline(result) : result;
    return { ...shown, today: todayKst(), mode, reader, deployed: isDeployed() };
  });
}
