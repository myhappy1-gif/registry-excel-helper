// 소개용 랜딩 페이지: 앱이 하는 일을 짧게 요약하고, "작업 시작"으로 실제 작업 화면(/work)에 들어가게 한다.
// 문구 원칙: 짧고 분명한 업무 말투. 수치는 가짜(샘플) 100건 기준 측정값이다(PLAN.md 37번).

import Link from "next/link";

const STEPS = [
  { n: 1, title: "파일 불러오기", body: "기존 엑셀, 구청 부과 이력, 전화번호 엑셀, 등기 PDF를 읽습니다." },
  { n: 2, title: "대조", body: "엑셀과 다른 항목만 표로 보여 줍니다. 직원이 맞는 값을 고릅니다." },
  { n: 3, title: "승인", body: "입력될 값을 확인하고 줄마다 승인하거나 제외합니다." },
  { n: 4, title: "입력·저장", body: "승인한 줄만 입력합니다. 수정본 엑셀을 내려받습니다." },
] as const;

const FEATURES = [
  { title: "등기 PDF 읽기", body: "PDF 안의 글자에서 소유자, 주민등록번호, 소유기간을 읽습니다." },
  { title: "엑셀 대조·보완", body: "표기만 다른 값은 같은 값으로 봅니다. 엑셀 빈칸은 등기 내용으로 채웁니다." },
  { title: "다른 값은 직원이 선택", body: "엑셀과 등기 값이 다르면 표로 나란히 보여 주고 직원이 고릅니다." },
  { title: "소유기간 자동 수정", body: "소유권이전일·소유종료일은 등기 기준으로 고치고, 바뀐 내용을 기록합니다." },
  { title: "전화번호 대조", body: "등기에 없는 전화번호는 이름·주소로 전화번호 엑셀과 맞춥니다." },
  { title: "부과 기간 계산", body: "소유자별로 부과 시작일·종료일을 계산합니다. 시작일이 주말이면 다음 월요일입니다." },
  { title: "승인", body: "입력될 값을 보고 승인한 줄만 다음 단계로 넘깁니다." },
  { title: "입력(모의)", body: "지번주소·성명·전화번호·주소·주민등록번호만 입력합니다. 연속 5건 실패하면 멈춥니다." },
  { title: "수정본 저장", body: "원본 엑셀은 그대로 두고 수정본을 새 파일로 만듭니다." },
] as const;

const RULES = [
  "원본 엑셀은 수정하지 않습니다.",
  "승인한 줄만 입력합니다.",
  "읽은 값의 확신도가 90% 미만이면 직원이 확인합니다.",
  "등기는 이 컴퓨터 안에서만 읽습니다.",
  "외부 AI(판독 강화)는 선택 기능이며, 켜면 경고가 나옵니다.",
  "바뀐 값은 출처와 함께 기록합니다.",
] as const;

const METRICS = [
  ["100건", "샘플 등기"],
  ["100%", "PDF 항목 일치율"],
  ["0.5%", "직원 확인 항목 비율"],
  ["70/70", "오류·빈칸 탐지"],
] as const;

export default function Home() {
  return (
    <div className="flex min-h-screen flex-col">
      <header className="bg-navy text-white">
        <div className="mx-auto flex w-full max-w-6xl items-center justify-between px-4 py-4 sm:px-8">
          <span className="text-[17px] font-semibold tracking-[-0.02em]">등기 대조·입력 도우미</span>
          <nav aria-label="바로가기" className="flex items-center gap-5 text-[14px]">
            <a href="#features" className="hidden text-[#c9d2ee] hover:text-white sm:inline">할 수 있는 일</a>
            <a href="#rules" className="hidden text-[#c9d2ee] hover:text-white sm:inline">안전장치</a>
            <Link href="/work" className="rounded-lg bg-white px-4 py-2 font-semibold text-navy hover:bg-navy-tint">대조 시작하기</Link>
          </nav>
        </div>
      </header>

      <main className="flex-1">
        {/* 소개 */}
        <section className="bg-navy text-white">
          <div className="mx-auto grid w-full max-w-6xl gap-10 px-4 pb-16 pt-8 sm:px-8 lg:grid-cols-[1fr_1fr] lg:items-center lg:gap-14 lg:pb-20">
            <div>
              <h1 className="text-[32px] font-semibold leading-[1.3] tracking-[-0.03em] sm:text-[38px]">
                읽고, 맞춰 보고,<br />승인만 하세요
              </h1>
              <p className="mt-4 max-w-xl text-[16px] leading-7 text-[#c9d2ee]">
                등기 PDF를 엑셀과 줄마다 비교해 두고, 서로 다른 곳만 보여드립니다. 변상금 부과 기간도 소유자별로 계산해 두며, 직원이 확인한 줄만 입력됩니다.
              </p>
              <div className="mt-7 flex flex-wrap gap-3">
                <Link href="/work" className="inline-flex min-h-11 items-center justify-center rounded-lg bg-brand px-7 text-[15px] font-semibold text-white transition-colors duration-150 hover:bg-[#e00047]">대조 시작하기</Link>
                <a href="#features" className="inline-flex min-h-11 items-center justify-center rounded-lg border border-white/35 px-6 text-[15px] font-medium text-white transition-colors duration-150 hover:bg-white/10">할 수 있는 일 보기</a>
              </div>
              <p className="mt-4 text-[12px] text-[#8fa0cf]">현재는 가짜(샘플) 데이터로만 동작합니다.</p>
            </div>

            {/* 화면 예시(같은 모양을 흉내 낸 정적 조각) */}
            <div aria-hidden="true">
              <p className="mb-2 text-[12px] text-[#8fa0cf]">화면 예시</p>
              <div className="rounded-xl bg-wash p-4 text-ink shadow-xl">
                <div className="grid grid-cols-4 gap-2">
                  {([["같음", "1,176", "border-[#b3b3b3]", "text-[#8c8c8c]"], ["자동 보완", "130", "border-navy", "text-navy"], ["충돌", "45", "border-brand", "text-brand"], ["확인 필요", "5", "border-brand-deep", "text-brand-deep"]] as const).map(([l, n, b, c]) => (
                    <div key={l} className={`rounded-lg border border-line border-l-4 bg-white px-2.5 py-2 ${b}`}>
                      <div className="text-[10px] text-muted">{l}</div>
                      <div className={`text-[19px] font-semibold leading-tight ${c}`}>{n}</div>
                    </div>
                  ))}
                </div>
                <div className="mt-3 overflow-hidden rounded-lg border border-line bg-white text-[11px]">
                  <div className="grid grid-cols-[1.1fr_1.4fr_1.4fr_1.2fr] gap-2 bg-[#eef0f5] px-3 py-2 font-semibold text-[#444a55]"><span>줄 · 항목</span><span>엑셀 값</span><span>등기 값</span><span>선택</span></div>
                  {[["하늘동 4 (1)", "주소", "시험로 4길 9", "연습로 4길 9"], ["하늘동 12 (1)", "주민번호", "900815-2574849", "900815-2574848"]].map(([a, b, c, d]) => (
                    <div key={a} className="grid grid-cols-[1.1fr_1.4fr_1.4fr_1.2fr] items-center gap-2 border-t border-line border-l-4 border-l-brand bg-[#fff8fa] px-3 py-2.5">
                      <span><b className="font-medium">{a}</b><br /><span className="text-muted">{b}</span></span>
                      <span>{c}</span><span className="font-medium text-navy">{d}</span>
                      <span className="flex gap-1"><span className="rounded border border-navy bg-navy px-1.5 py-0.5 text-white">엑셀 유지</span><span className="rounded border border-[#c9cedb] px-1.5 py-0.5 text-navy">등기 사용</span></span>
                    </div>
                  ))}
                  <div className="flex items-center justify-between border-t border-line px-3 py-2"><span className="text-muted">남은 확인 <b className="text-brand">48개</b></span><span className="rounded bg-navy px-2.5 py-1 font-semibold text-white">다음: 승인하기</span></div>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* 수치 */}
        <section aria-label="샘플 데이터 측정 결과" className="border-b border-line bg-white">
          <dl className="mx-auto grid w-full max-w-6xl grid-cols-2 gap-y-5 px-4 py-6 sm:px-8 lg:grid-cols-4">
            {METRICS.map(([n, l]) => (
              <div key={l} className="border-l-4 border-navy pl-4">
                <dd className="text-[28px] font-semibold leading-none tracking-[-0.02em] text-navy">{n}</dd>
                <dt className="mt-1.5 text-[13px] text-muted">{l}</dt>
              </div>
            ))}
          </dl>
          <p className="mx-auto w-full max-w-6xl px-4 pb-4 text-[12px] text-muted sm:px-8">가짜(샘플) 데이터 100건 기준입니다. 실제 등기 정확도는 실제 자료로 따로 확인해야 합니다.</p>
        </section>

        {/* 사용 순서 */}
        <section className="mx-auto w-full max-w-6xl px-4 py-14 sm:px-8">
          <h2 className="text-[24px] font-semibold tracking-[-0.03em]">사용 순서</h2>
          <ol className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {STEPS.map((s) => (
              <li key={s.n} className="rounded-xl border border-line bg-white p-5">
                <span className="flex h-7 w-7 items-center justify-center rounded-full bg-navy text-[13px] font-semibold text-white">{s.n}</span>
                <h3 className="mt-3 text-[16px] font-semibold">{s.title}</h3>
                <p className="mt-1.5 text-[14px] leading-6 text-muted">{s.body}</p>
              </li>
            ))}
          </ol>
        </section>

        {/* 기능 */}
        <section id="features" className="border-y border-line bg-white py-14">
          <div className="mx-auto w-full max-w-6xl px-4 sm:px-8">
            <h2 className="text-[24px] font-semibold tracking-[-0.03em]">할 수 있는 일</h2>
            <ul className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {FEATURES.map((f) => (
                <li key={f.title} className="rounded-xl border border-line bg-wash p-5">
                  <h3 className="text-[16px] font-semibold">{f.title}</h3>
                  <p className="mt-1.5 text-[14px] leading-6 text-muted">{f.body}</p>
                </li>
              ))}
            </ul>
          </div>
        </section>

        {/* 부과 기간 */}
        <section className="mx-auto w-full max-w-6xl px-4 py-14 sm:px-8">
          <h2 className="text-[24px] font-semibold tracking-[-0.03em]">소유자가 바뀐 경우</h2>
          <p className="mt-2 max-w-3xl text-[15px] leading-7 text-muted">
            구청 마지막 부과일 뒤에 소유자가 바뀌면, 소유 기간별로 나눠 계산합니다. 건물 소유기간이 길어도 부과는 구청 마지막 부과일 다음 날부터입니다.
          </p>
          <div className="mt-6 rounded-xl border border-line bg-white p-5 sm:p-6">
            <div className="grid grid-cols-[repeat(14,minmax(0,1fr))] overflow-hidden rounded-lg text-center text-[12px]" role="img" aria-label="기간 나누기 예시: 구청 부과 완료, 이전 소유자, 현재 소유자 순서">
              <div className="col-span-5 bg-[#e6e6e6] py-3 text-[#555]">구청 부과 완료</div>
              <div className="col-span-4 bg-navy py-3 font-medium text-white">이전 소유자</div>
              <div className="col-span-5 bg-brand py-3 font-medium text-white">현재 소유자</div>
            </div>
            <div className="mt-2 grid grid-cols-[repeat(14,minmax(0,1fr))] text-[11px] text-muted">
              <span className="col-span-5">구청 마지막 부과 종료일</span>
              <span className="col-span-4">다음 날부터 (주말이면 월요일)</span>
              <span className="col-span-5">소유자 교체일부터 부과 종료일까지</span>
            </div>
          </div>
        </section>

        {/* 안전 규칙 */}
        <section id="rules" className="bg-navy py-14 text-white">
          <div className="mx-auto w-full max-w-6xl px-4 sm:px-8">
            <h2 className="text-[24px] font-semibold tracking-[-0.03em]">안전장치</h2>
            <ul className="mt-6 grid gap-x-8 gap-y-4 sm:grid-cols-2 lg:grid-cols-3">
              {RULES.map((t) => (
                <li key={t} className="border-t border-white/25 pt-3 text-[15px] leading-6">{t}</li>
              ))}
            </ul>
          </div>
        </section>

        <section className="mx-auto w-full max-w-6xl px-4 py-12 sm:px-8">
          <div className="flex flex-col items-start justify-between gap-4 rounded-xl border border-line bg-white p-6 sm:flex-row sm:items-center">
            <p className="text-[16px] font-medium">샘플 데이터로 바로 시험해 볼 수 있습니다.</p>
            <Link href="/work" className="inline-flex min-h-11 shrink-0 items-center justify-center rounded-lg bg-navy px-8 text-[15px] font-semibold text-white transition-colors duration-150 hover:bg-navy-hover">대조 시작하기</Link>
          </div>
        </section>
      </main>

      <footer className="border-t border-line bg-white">
        <div className="mx-auto flex w-full max-w-6xl flex-wrap items-center justify-between gap-3 px-4 py-5 text-[13px] text-muted sm:px-8">
          <span>가짜(샘플) 데이터 전용 · 사내 프로그램 입력은 모의</span>
          <span className="flex gap-4">
            <a className="hover:text-navy" href="https://github.com/myhappy1-gif/registry-excel-helper/blob/main/PRD.md">기획서</a>
            <a className="hover:text-navy" href="https://github.com/myhappy1-gif/registry-excel-helper/blob/main/PLAN.md">작업 계획</a>
            <a className="hover:text-navy" href="https://github.com/myhappy1-gif/registry-excel-helper">GitHub</a>
          </span>
        </div>
      </footer>
    </div>
  );
}
