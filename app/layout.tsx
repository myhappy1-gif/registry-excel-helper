import type { Metadata } from "next";
import localFont from "next/font/local";
import "./globals.css";

// 글꼴: Pretendard 가변 글꼴(무료 오픈소스, OFL). 파일을 프로젝트에 직접 두어 어느 PC에서나 같은 모양으로 보인다.
const pretendard = localFont({
  src: "./fonts/PretendardVariable.woff2",
  variable: "--font-pretendard",
  weight: "45 920",
  display: "swap",
});

export const metadata: Metadata = {
  title: "재개발구역 변상금 부과 도우미",
  description: "등기 내용을 엑셀과 대조하고, 직원이 승인한 건만 입력하는 업무 자동화 앱",
  // 왜: 가짜 데이터 시연 주소가 검색 결과에 노출되지 않게 한다.
  robots: { index: false, follow: false },
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="ko" className={`${pretendard.variable} h-full antialiased`}>
      <body className="min-h-full flex flex-col font-sans">{children}</body>
    </html>
  );
}
