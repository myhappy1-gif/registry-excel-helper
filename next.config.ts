import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /* config options here */
  cacheComponents: true,
  partialPrefetching: true,
  // 글자 읽기(Tesseract.js)는 자기 안의 작업 파일을 경로로 찾아 쓰므로, 빌드 도구가 묶지 않고 그대로 불러오게 한다.
  // (묶으면 "worker-script 파일을 찾을 수 없음" 오류가 난다 — 실제로 확인함)
  // PDF 글자 꺼내기(pdfjs-dist)도 같은 이유로 묶지 않고 그대로 불러온다.
  serverExternalPackages: ["tesseract.js", "pdfjs-dist"],
  // Design Ref: §9 보안 설계 — 다른 사이트가 화면을 몰래 감싸는 것(클릭재킹) 등을 막는 기본 보안 헤더.
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          // 원본 등기를 같은 화면 안에서 열어 보려면 같은 사이트의 틀 안 표시는 허용해야 한다. 다른 사이트가 감싸는 것은 계속 막는다.
          { key: "X-Frame-Options", value: "SAMEORIGIN" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "no-referrer" },
          { key: "X-Robots-Tag", value: "noindex, nofollow" },
        ],
      },
    ];
  },
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
