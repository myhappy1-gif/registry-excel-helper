// 실제 작업 화면(4단계). 첫 화면(/)은 소개용 랜딩 페이지이고, 여기서부터 실전 작업이 시작된다.
import type { Metadata } from "next";
import Workflow from "../components/Workflow";

export const metadata: Metadata = { title: "작업 화면 · 등기 대조·입력 도우미" };

export default function WorkPage() {
  return <Workflow />;
}
