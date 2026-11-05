import path from "node:path";
import { handlePost, xlsxResponse } from "@/lib/api";
import { buildRowsWorkbook, saveNewWorkbook } from "@/lib/excel-io";
import { isDeployed, outputDir } from "@/lib/runtime-mode";
import { parseRows } from "@/lib/validate";

// 수정본 엑셀: 항상 새 파일이다. 이 컴퓨터에서는 output/ 폴더에도 한 부 저장하고, 원본은 건드리지 않는다.
export async function POST(request: Request) {
  return handlePost(request, async (body) => {
    const buffer = await buildRowsWorkbook(parseRows(body.rows));
    const stamp = new Date().toISOString().replace(/[-:T]/g, "").slice(0, 14);
    const fileName = `수정본_${stamp}.xlsx`;
    if (!isDeployed()) {
      try {
        await saveNewWorkbook(buffer, outputDir(), fileName, path.resolve(process.cwd(), "sample-data", "fake-existing.xlsx"));
      } catch {
        /* 저장하지 못해도 내려받기는 된다 */
      }
    }
    return xlsxResponse(buffer, fileName);
  });
}
