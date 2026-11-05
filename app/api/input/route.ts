import { handlePost } from "@/lib/api";
import { compareCounts, makeMockInput, runInput, type MockRecord } from "@/lib/input-queue";
import { isDeployed } from "@/lib/runtime-mode";
import { formatRowId } from "@/lib/row-id";
import { appendMockRecords, saveStateSync } from "@/lib/state-store";
import { parseJobs, parseRows, parseStringList } from "@/lib/validate";

// 모의 입력: 승인된 줄만, 다섯 항목만. 이 컴퓨터에서는 줄마다 .work/state.json에 저장해 이어서 처리할 수 있다.
export async function POST(request: Request) {
  return handlePost(request, async (body) => {
    const rows = parseRows(body.rows);
    const jobs = parseJobs(body.jobs);
    const failKeys = new Set(parseStringList(body.failKeys, 200)); // 시험용: 일부러 실패시킬 줄
    const records: MockRecord[] = [];
    const run = runInput(jobs, {
      doInput: makeMockInput(new Map(rows.map((r) => [formatRowId(r.rowId), r])), failKeys, (rec) => records.push(rec)),
      onProgress: (snapshot) =>
        saveStateSync({ updatedAt: new Date().toISOString(), rows, jobs: [...snapshot], unprocessed: [], stoppedEarly: false }),
    });
    const saved = !isDeployed();
    if (saved) {
      saveStateSync({ updatedAt: new Date().toISOString(), rows, jobs: run.jobs, unprocessed: run.unprocessed, stoppedEarly: run.stoppedEarly });
      await appendMockRecords(records);
    }
    return { ...run, compare: compareCounts(run.jobs), saved };
  });
}
