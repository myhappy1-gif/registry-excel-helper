import { handlePost, xlsxResponse } from "@/lib/api";
import { buildReportWorkbook } from "@/lib/excel-io";
import { buildReportSummary } from "@/lib/report";
import type { ReconcileItem } from "@/lib/types";
import { parseItemStatuses, parseJobs, parseUnprocessed } from "@/lib/validate";

// 결과 리포트 엑셀: 건수와 미처리 목록만 담는다(개인정보 없음).
export async function POST(request: Request) {
  return handlePost(request, async (body) => {
    const summary = buildReportSummary(
      parseItemStatuses(body.items) as ReconcileItem[], // 건수를 세는 데는 상태만 쓴다
      parseJobs(body.jobs),
      parseUnprocessed(body.unprocessed),
    );
    return xlsxResponse(await buildReportWorkbook(summary), "결과리포트.xlsx");
  });
}
