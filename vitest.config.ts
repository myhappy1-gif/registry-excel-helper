import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

// 업무 규칙(lib/)을 자동으로 시험하기 위한 설정. 화면 없이 서버 환경(node)에서 돌린다.
export default defineConfig({
  resolve: {
    alias: { "@": fileURLToPath(new URL("./", import.meta.url)) },
  },
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
  },
});
