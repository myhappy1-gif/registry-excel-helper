// Design Ref: §2 ⓐ — 글자가 들어 있는 등기 PDF에서 글자를 위치(x, y)와 함께 꺼낸다. 글자 읽기(OCR)를 거치지 않는다.
// Plan: PLAN.md 26번. 서버에서만 쓴다(pdfjs-dist). 파일 안의 글자를 그대로 꺼낼 뿐, 외부로 보내지 않는다.

export interface PdfItem {
  str: string;
  /** 왼쪽에서의 거리 */
  x: number;
  /** 아래에서의 거리 (클수록 위쪽) */
  y: number;
  size: number;
  /** 글자 조각의 가로 길이 */
  width: number;
}

/** 한 쪽의 글자 조각들 */
export type PdfPage = PdfItem[];

/** 워터마크("열람용")처럼 기울었거나 아주 큰 글자는 본문이 아니다. */
const MAX_BODY_FONT_SIZE = 30;

export async function extractPdfPages(data: Uint8Array): Promise<PdfPage[]> {
  // legacy 빌드는 Node(서버)에서도 동작한다. 글자만 꺼내므로 그림 그리기 도구(canvas)는 필요 없다.
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const task = pdfjs.getDocument({ data, verbosity: 0, useSystemFonts: false });
  const doc = await task.promise;
  const pages: PdfPage[] = [];
  try {
    for (let p = 1; p <= doc.numPages; p++) {
      const page = await doc.getPage(p);
      const content = await page.getTextContent();
      const items: PdfPage = [];
      for (const raw of content.items) {
        if (!("str" in raw) || raw.str.trim() === "") continue;
        const [a, b, c, , x, y] = raw.transform as number[];
        const rotated = Math.abs(b) > 0.01 || Math.abs(c) > 0.01;
        const size = Math.hypot(a, b);
        if (rotated || size >= MAX_BODY_FONT_SIZE) continue; // 워터마크
        items.push({ str: raw.str, x, y, size, width: raw.width });
      }
      pages.push(items);
    }
  } finally {
    await task.destroy();
  }
  return pages;
}
