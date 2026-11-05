// Design Ref: §9.7 — 값을 바꾸는 서버 입구(승인·입력 등)는 다른 사이트가 몰래 보낸 요청을 받지 않도록 요청을 보낸 사이트 주소(Origin)를 검사한다.

/** Origin 값이 이 서버의 Host와 같을 때만 true. Origin이 없거나 다르면 false. */
export function isSameOrigin(request: Request): boolean {
  const origin = request.headers.get("origin");
  const host = request.headers.get("host");
  if (!origin || !host) return false;
  try {
    return new URL(origin).host === host;
  } catch {
    return false;
  }
}
