// Design Ref: §1 화면 구성 — 첫 화면은 4단계 작업 화면(Workflow)이다. 앱 이름·진행 표시·안내 문구는 Workflow 위쪽에 있다.
// 안내 문구는 쉬운 한국어로 쓴다. 이 앱은 연습용 가짜 데이터로만 동작한다.

import Workflow from "./components/Workflow";

export default function Home() {
  return (
    <main className="mx-auto flex w-full max-w-5xl flex-1 flex-col px-4 py-8 sm:px-8 sm:py-12">
      <Workflow />
    </main>
  );
}
