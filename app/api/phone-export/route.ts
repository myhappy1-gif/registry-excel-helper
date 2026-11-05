import { handlePost, xlsxResponse } from "@/lib/api";
import { buildPhoneWorkbook } from "@/lib/excel-io";
import { parsePhoneSheetRows } from "@/lib/validate";

// 전화번호 대조표 엑셀: 수정본과 따로 내려받는 파일. 서버에 저장하지 않고 바로 내려준다.
export async function POST(request: Request) {
  return handlePost(request, async (body) => {
    const buffer = await buildPhoneWorkbook(parsePhoneSheetRows(body.rows));
    const stamp = new Date().toISOString().replace(/[-:T]/g, "").slice(0, 14);
    return xlsxResponse(buffer, `전화번호대조표_${stamp}.xlsx`);
  });
}
