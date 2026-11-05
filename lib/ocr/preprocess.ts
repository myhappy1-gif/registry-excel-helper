// Design Ref: §2 ⓐ — 회차마다 읽는 방법을 바꾼다: 1회 원본 → 2회 흑백·선명하게 처리한 그림 → 3회 확대한 그림.
// 왜: 같은 그림을 같은 방법으로 읽으면 결과가 늘 같아서 반복 검증이 의미가 없다. (가벼운 PNG 처리 도구 pngjs 사용)

import { PNG } from "pngjs";

function gray(png: PNG): Uint8Array {
  const out = new Uint8Array(png.width * png.height);
  for (let i = 0; i < out.length; i++) {
    const p = i * 4;
    out[i] = Math.round(0.299 * png.data[p] + 0.587 * png.data[p + 1] + 0.114 * png.data[p + 2]);
  }
  return out;
}

function fromGray(values: Uint8Array, width: number, height: number): PNG {
  const png = new PNG({ width, height });
  for (let i = 0; i < values.length; i++) {
    const p = i * 4;
    png.data[p] = png.data[p + 1] = png.data[p + 2] = values[i];
    png.data[p + 3] = 255;
  }
  return png;
}

/** 흑백으로 바꾸고 글자와 배경을 또렷하게(밝기 기준으로 검정/흰색) 만든다. */
export function sharpen(buffer: Buffer): Buffer {
  const png = PNG.sync.read(buffer);
  const g = gray(png);
  const out = g.map((v) => (v < 170 ? 0 : 255)) as Uint8Array;
  return PNG.sync.write(fromGray(out, png.width, png.height));
}

/** 흑백으로 바꾸고 가로세로 factor배로 키운다(가장 가까운 점 복사). */
export function enlarge(buffer: Buffer, factor = 2): Buffer {
  const png = PNG.sync.read(buffer);
  const g = gray(png);
  const width = png.width * factor;
  const height = png.height * factor;
  const out = new Uint8Array(width * height);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      out[y * width + x] = g[Math.floor(y / factor) * png.width + Math.floor(x / factor)];
    }
  }
  return PNG.sync.write(fromGray(out, width, height));
}
