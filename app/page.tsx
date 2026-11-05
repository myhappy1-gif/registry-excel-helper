// 소개용 랜딩 페이지: 앱이 하는 일을 한 장으로 요약하고, "작업 시작"으로 실제 작업 화면(/work)에 들어가게 한다.
// 서버에서 그리는 정적 페이지라 상태가 없다. 수치는 가짜(샘플) 100건 기준 측정값이다(PLAN.md 37번).

import Link from "next/link";

const FLOW = [
  { n: 1, title: "파일 불러오기", body: "기존 엑셀, 구청 부과 이력, 전화번호 엑셀, 등기 PDF를 읽고 부과 종료일을 한 번에 정합니다." },
  { n: 2, title: "대조 결과", body: "같음·자동 보완·충돌·확인 필요로 나누고, 사람이 판단할 항목만 비교 표로 보여 줍니다." },
  { n: 3, title: "승인", body: "줄마다 입력될 값과 바뀐 내용을 보고 승인하거나 제외합니다. 승인한 줄만 다음으로 갑니다." },
  { n: 4, title: "입력·리포트", body: "승인한 줄만 입력하고, 막힌 줄은 건너뛰어 미처리 목록에 남깁니다. 수정본·리포트를 엑셀로 받습니다." },
] as const;

const FEATURES = [
  { title: "PDF 글자를 그대로 읽기", body: "글자가 들어 있는 등기 PDF는 OCR 없이 소유자·주민번호·소유기간을 꺼냅니다. 형식이 이상한 값은 자동으로 확인 필요로 보냅니다.", tag: "읽기" },
  { title: "엑셀과 항목별 대조", body: "공백·쉼표·하이픈·날짜 표기 차이는 같은 값으로 봅니다. 엑셀 빈칸만 자동 보완하고 값이 다르면 충돌로 남깁니다.", tag: "대조" },
  { title: "소유기간은 등기 기준", body: "소유권이전일·소유종료일은 믿을 만하게 읽히면 등기 값으로 고치고, 엑셀에 있던 값과 함께 기록합니다.", tag: "대조" },
  { title: "충돌 비교 표", body: "엑셀 값과 새 값(출처)을 한 줄로 비교합니다. 같은 종류는 묶어서 정하고, 원본 등기를 바로 열어 볼 수 있습니다.", tag: "확인" },
  { title: "전화번호 엑셀 대조", body: "등기에 없는 전화번호는 이름·주소로 전화번호 엑셀과 맞춥니다. 이름과 주소가 모두 같을 때만 채우고, 대조표를 따로 받습니다.", tag: "대조" },
  { title: "변상금 부과 기간 계산", body: "구청 마지막 부과 종료일 다음 날(토·일이면 월요일)부터 일괄 입력한 종료일까지, 소유자별로 나눠 계산합니다.", tag: "계산" },
  { title: "직원 승인 단계", body: "입력될 다섯 항목과 부과 기간을 보고 승인합니다. 바뀐 줄만 걸러 보고, 바뀌지 않은 줄은 한 번에 승인합니다.", tag: "승인" },
  { title: "안전한 모의 입력", body: "승인한 줄만, 지정한 다섯 항목만 입력합니다. 이미 넣은 줄은 건너뛰고 연속 5건 실패하면 멈춥니다.", tag: "입력" },
  { title: "엑셀 수정본·리포트", body: "원본은 그대로 두고 수정본을 새 파일로 만듭니다. 건수 중심 리포트는 개인정보를 가려서 남깁니다.", tag: "결과" },
] as const;

const RULES = [
  ["원본 엑셀은 덮어쓰지 않습니다", "수정본은 항상 새 파일입니다."],
  ["승인한 줄만 입력합니다", "승인 없이 입력하는 길이 코드에 없습니다."],
  ["확신도 90% 미만은 자동 수정 금지", "의심되는 값은 확인 필요로 보냅니다."],
  ["등기는 이 컴퓨터 안에서만 읽습니다", "외부 서버로 보내지 않는 것이 기본입니다."],
  ["외부 AI는 선택 사항입니다", "켜면 경고와 동의가 필요하고, 가짜 샘플만 보냅니다."],
  ["모든 변경에 출처를 남깁니다", "어느 파일·몇 회차·직원 선택인지 기록합니다."],
] as const;

const METRICS = [
  ["100건", "가짜 등기 샘플 (사례 70건 설계)"],
  ["100%", "PDF 항목 일치율 (990/990)"],
  ["0.5%", "직원이 확인할 항목 비율"],
  ["70/70", "심어 둔 오류·빈칸 탐지"],
] as const;

const btnPrimary = "inline-flex min-h-11 items-center justify-center rounded-lg bg-brand px-7 text-[15px] font-semibold text-white transition-colors duration-150 hover:bg-[#e00047]";
const btnGhost = "inline-flex min-h-11 items-center justify-center rounded-lg border border-white/35 px-6 text-[15px] font-medium text-white transition-colors duration-150 hover:bg-white/10";

export default function Home() {
  return (
    <div className="flex min-h-screen flex-col">
      {/* 상단 바 */}
      <header className="bg-navy text-white">
        <div className="mx-auto flex w-full max-w-6xl items-center justify-between px-4 py-4 sm:px-8">
          <span className="text-[17px] font-semibold tracking-[-0.02em]">등기 대조·입력 도우미</span>
          <nav aria-label="바로가기" className="flex items-center gap-5 text-[14px]">
            <a href="#features" className="hidden text-[#c9d2ee] hover:text-white sm:inline">기능</a>
            <a href="#rules" className="hidden text-[#c9d2ee] hover:text-white sm:inline">안전 규칙</a>
            <Link href="/work" className="rounded-lg bg-white px-4 py-2 font-semibold text-navy hover:bg-navy-tint">작업 시작</Link>
          </nav>
        </div>
      </header>

      <main className="flex-1">
        {/* 첫 영역 */}
        <section className="bg-navy text-white">
          <div className="mx-auto grid w-full max-w-6xl gap-10 px-4 pb-16 pt-6 sm:px-8 lg:grid-cols-[1.05fr_1fr] lg:items-center lg:gap-14 lg:pb-20">
            <div>
              <p className="text-[13px] font-medium text-[#aab6dc]">등기 수백 건 · 엑셀 대조 · 변상금 부과 기간</p>
              <h1 className="mt-3 text-[34px] font-semibold leading-[1.25] tracking-[-0.03em] sm:text-[42px]">
                등기와 엑셀을 맞춰 보고,<br />승인한 줄만 입력합니다.
              </h1>
              <p className="mt-4 max-w-xl text-[16px] leading-7 text-[#c9d2ee]">
                눈으로 한 건씩 대조하고 손으로 다시 입력하던 일을 한 흐름으로 묶었습니다. 사람은 <strong className="font-semibold text-white">판단이 필요한 항목만</strong> 확인합니다.
              </p>
              <div className="mt-7 flex flex-wrap gap-3">
                <Link href="/work" className={btnPrimary}>작업 시작하기</Link>
                <a href="#features" className={btnGhost}>기능 살펴보기</a>
              </div>
              <p className="mt-4 text-[12px] text-[#8fa0cf]">연습용 가짜(샘플) 데이터로만 동작합니다. 실제 등기·개인정보는 들어 있지 않습니다.</p>
            </div>

            {/* 화면 미리보기(그림이 아니라 같은 모양을 흉내 낸 정적 조각) */}
            <div aria-hidden="true" className="rounded-xl bg-wash p-4 text-ink shadow-xl">
              <div className="grid grid-cols-4 gap-2">
                {([["같음", "1,176", "border-[#b3b3b3] text-[#8c8c8c]"], ["자동 보완", "130", "border-navy text-navy"], ["충돌", "45", "border-brand text-brand"], ["확인 필요", "5", "border-brand-deep text-brand-deep"]] as const).map(([l, n, c]) => (
                  <div key={l} className={`rounded-lg border border-line border-l-4 bg-white px-2.5 py-2 ${c.split(" ")[0]}`}>
                    <div className="text-[10px] text-muted">{l}</div>
                    <div className={`text-[19px] font-semibold leading-tight ${c.split(" ")[1]}`}>{n}</div>
                  </div>
                ))}
              </div>
              <div className="mt-3 overflow-hidden rounded-lg border border-line bg-white text-[11px]">
                <div className="grid grid-cols-[1.1fr_1.4fr_1.4fr_1.2fr] gap-2 bg-[#eef0f5] px-3 py-2 font-semibold text-[#444a55]"><span>줄 · 항목</span><span>엑셀 값</span><span>새 값</span><span>선택</span></div>
                {[["하늘동 4 (1)", "주소", "시험로 4길 9", "연습로 4길 9"], ["하늘동 12 (1)", "주민번호", "900815-2574849", "900815-2574848"]].map(([a, b, c, d]) => (
                  <div key={a} className="grid grid-cols-[1.1fr_1.4fr_1.4fr_1.2fr] items-center gap-2 border-t border-line border-l-4 border-l-brand bg-[#fff8fa] px-3 py-2.5">
                    <span><b className="font-medium">{a}</b><br /><span className="text-muted">{b}</span></span>
                    <span>{c}</span><span className="font-medium text-navy">{d}</span>
                    <span className="flex gap-1"><span className="rounded border border-navy bg-navy px-1.5 py-0.5 text-white">엑셀 유지</span><span className="rounded border border-[#c9cedb] px-1.5 py-0.5 text-navy">등기</span></span>
                  </div>
                ))}
                <div className="flex items-center justify-between border-t border-line px-3 py-2"><span className="text-muted">남은 확인 <b className="text-brand">48개</b></span><span className="rounded bg-navy px-2.5 py-1 font-semibold text-white">다음: 승인하기</span></div>
              </div>
            </div>
          </div>
        </section>

        {/* 측정 결과 띠 */}
        <section aria-label="측정 결과" className="border-b border-line bg-white">
          <dl className="mx-auto grid w-full max-w-6xl grid-cols-2 gap-y-5 px-4 py-6 sm:px-8 lg:grid-cols-4">
            {METRICS.map(([n, l]) => (
              <div key={l} className="border-l-4 border-navy pl-4">
                <dd className="text-[28px] font-semibold leading-none tracking-[-0.02em] text-navy">{n}</dd>
                <dt className="mt-1.5 text-[13px] text-muted">{l}</dt>
              </div>
            ))}
          </dl>
          <p className="mx-auto w-full max-w-6xl px-4 pb-4 text-[12px] text-muted sm:px-8">※ 모두 가짜(샘플) 데이터 기준입니다. 실제 등기에서의 정확도는 실제 자료로 별도 시험이 필요합니다.</p>
        </section>

        {/* 4단계 흐름 */}
        <section className="mx-auto w-full max-w-6xl px-4 py-14 sm:px-8">
          <h2 className="text-[26px] font-semibold tracking-[-0.03em]">작업은 4단계로 끝납니다</h2>
          <p className="mt-2 text-[15px] text-muted">한 화면 안에서 순서대로 진행합니다. 끝난 단계로는 언제든 돌아갈 수 있습니다.</p>
          <ol className="mt-7 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {FLOW.map((s) => (
              <li key={s.n} className="relative rounded-xl border border-line bg-white p-5">
                <span className="flex h-8 w-8 items-center justify-center rounded-full bg-navy text-[14px] font-semibold text-white">{s.n}</span>
                <h3 className="mt-3 text-[16px] font-semibold">{s.title}</h3>
                <p className="mt-1.5 text-[14px] leading-6 text-muted">{s.body}</p>
              </li>
            ))}
          </ol>
        </section>

        {/* 기능 */}
        <section id="features" className="border-y border-line bg-white py-14">
          <div className="mx-auto w-full max-w-6xl px-4 sm:px-8">
            <h2 className="text-[26px] font-semibold tracking-[-0.03em]">주요 기능</h2>
            <p className="mt-2 text-[15px] text-muted">읽기부터 입력까지, 실제 업무에서 막히던 지점을 기능으로 풀었습니다.</p>
            <ul className="mt-7 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {FEATURES.map((f) => (
                <li key={f.title} className="rounded-xl border border-line bg-wash p-5">
                  <span className="inline-block rounded-md bg-navy-tint px-2 py-0.5 text-[12px] font-medium text-navy">{f.tag}</span>
                  <h3 className="mt-2.5 text-[16px] font-semibold">{f.title}</h3>
                  <p className="mt-1.5 text-[14px] leading-6 text-muted">{f.body}</p>
                </li>
              ))}
            </ul>
          </div>
        </section>

        {/* 부과 기간 예시 */}
        <section className="mx-auto w-full max-w-6xl px-4 py-14 sm:px-8">
          <h2 className="text-[26px] font-semibold tracking-[-0.03em]">소유자가 바뀌어도 기간을 나눠 계산합니다</h2>
          <p className="mt-2 max-w-3xl text-[15px] leading-7 text-muted">
            구청이 마지막으로 부과한 날 뒤에 소유자가 바뀌면, 각자 소유한 기간만큼 나눠 부과합니다. 건물 소유기간이 길어도 부과는 구청 마지막 부과일 다음 날부터입니다.
          </p>
          <div className="mt-7 rounded-xl border border-line bg-white p-5 sm:p-6">
            <div className="grid grid-cols-[repeat(14,minmax(0,1fr))] overflow-hidden rounded-lg text-center text-[12px]" aria-label="기간 나누기 예시">
              <div className="col-span-5 bg-[#e6e6e6] py-3 text-[#666]">구청이 이미 부과 (용도폐지 전까지)</div>
              <div className="col-span-4 bg-navy py-3 font-medium text-white">앞 소유자 1</div>
              <div className="col-span-5 bg-brand py-3 font-medium text-white">새 소유자 2 → 부과 종료일</div>
            </div>
            <div className="mt-2 grid grid-cols-[repeat(14,minmax(0,1fr))] text-[11px] text-muted">
              <span className="col-span-5">… 구청 마지막 부과 종료일</span>
              <span className="col-span-4">다음 날(토·일이면 월요일)부터</span>
              <span className="col-span-5">소유자 교체일부터</span>
            </div>
            <p className="mt-4 text-[13px] text-muted">같은 규칙으로 연쇄 교체, 공유자, 구청 이력 없음, 이미 부과가 끝난 경우까지 사례별로 시험합니다.</p>
          </div>
        </section>

        {/* 안전 규칙 */}
        <section id="rules" className="bg-navy py-14 text-white">
          <div className="mx-auto w-full max-w-6xl px-4 sm:px-8">
            <h2 className="text-[26px] font-semibold tracking-[-0.03em]">정확해야 하는 일이라, 규칙으로 막아 두었습니다</h2>
            <ul className="mt-7 grid gap-x-8 gap-y-5 sm:grid-cols-2 lg:grid-cols-3">
              {RULES.map(([t, b]) => (
                <li key={t} className="border-t border-white/25 pt-3">
                  <h3 className="text-[15px] font-semibold">{t}</h3>
                  <p className="mt-1 text-[14px] leading-6 text-[#c9d2ee]">{b}</p>
                </li>
              ))}
            </ul>
          </div>
        </section>

        {/* 마무리 */}
        <section className="mx-auto w-full max-w-6xl px-4 py-14 sm:px-8">
          <div className="flex flex-col items-start justify-between gap-5 rounded-xl border border-line bg-white p-6 sm:flex-row sm:items-center sm:p-8">
            <div>
              <h2 className="text-[22px] font-semibold tracking-[-0.03em]">바로 시작해 보세요</h2>
              <p className="mt-1 text-[14px] text-muted">샘플 데이터가 준비되어 있어서 파일 없이도 흐름을 끝까지 돌려 볼 수 있습니다.</p>
            </div>
            <Link href="/work" className="inline-flex min-h-11 shrink-0 items-center justify-center rounded-lg bg-navy px-8 text-[15px] font-semibold text-white transition-colors duration-150 hover:bg-navy-hover">작업 시작하기</Link>
          </div>
        </section>
      </main>

      <footer className="border-t border-line bg-white">
        <div className="mx-auto flex w-full max-w-6xl flex-wrap items-center justify-between gap-3 px-4 py-5 text-[13px] text-muted sm:px-8">
          <span>연습용 가짜(샘플) 데이터 전용 · 사내 프로그램 입력은 모의입니다</span>
          <span className="flex gap-4">
            <a className="hover:text-navy" href="https://github.com/myhappy1-gif/registry-excel-helper/blob/main/PRD.md">기획서(PRD)</a>
            <a className="hover:text-navy" href="https://github.com/myhappy1-gif/registry-excel-helper/blob/main/PLAN.md">작업 계획(PLAN)</a>
            <a className="hover:text-navy" href="https://github.com/myhappy1-gif/registry-excel-helper">GitHub</a>
          </span>
        </div>
      </footer>
    </div>
  );
}
