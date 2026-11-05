// Design Ref: §1 화면 구성 — 첫 화면은 4단계 작업 화면(Workflow)이다. 앱 이름·단계 탭·안내 문구는 Workflow 위쪽에 있다.
// 안내 문구는 쉬운 한국어로 쓴다. 이 앱은 연습용 가짜 데이터로만 동작한다.

import Workflow from "./components/Workflow";

export default function Home() {
  return <Workflow />;
}
