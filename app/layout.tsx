import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "등기 대조·입력 도우미",
  description: "등기 내용을 엑셀과 대조하고, 직원이 승인한 건만 입력하는 업무 자동화 앱",
  // 왜: 가짜 데이터 시연 주소가 검색 결과에 노출되지 않게 한다.
  robots: { index: false, follow: false },
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="ko" className="h-full antialiased">
      <body className="min-h-full flex flex-col font-sans">{children}</body>
    </html>
  );
}
