// 연습용 가짜 등기사항전부증명서(PDF, 글자가 들어 있는 형식)를 만든다.
// 인터넷등기소 "열람용" 등기의 모양(일반 건물 등기: 표제부 → 갑구 → 을구, 3쪽, "열람용" 워터마크)을 흉내 낸다. 주민번호는 가짜라서 뒷자리까지 그대로 적는다.
// 내용은 sample-data/fake-sample.json 의 정답표(registries)에서만 가져오고, 나머지는 전부 무작위 가짜 값이다. 실제 등기 내용은 쓰지 않는다.
// 만드는 방법: 새 도구 설치 없이 Windows에 있는 Edge 브라우저의 "PDF로 인쇄" 기능을 쓴다.
// 실행: npm run sample:pdf   (Edge 위치가 다르면 EDGE_PATH 환경 변수로 알려 준다)

import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

const root = path.resolve(import.meta.dirname, "..");
const truth = JSON.parse(readFileSync(path.join(root, "sample-data/fake-sample.json"), "utf8")).registries;
const outDir = path.join(root, "sample-data/pdfs");
const htmlDir = path.join(root, ".work/pdf-html"); // 작업 폴더(깃 제외), 끝나면 지운다
mkdirSync(outDir, { recursive: true });
mkdirSync(htmlDir, { recursive: true });

function findEdge() {
  const candidates = [
    process.env.EDGE_PATH,
    "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
    "C:/Program Files/Microsoft/Edge/Application/msedge.exe",
    "C:/Program Files/Google/Chrome/Application/chrome.exe",
  ].filter(Boolean);
  const hit = candidates.find((c) => existsSync(c));
  if (!hit) throw new Error("Edge(또는 Chrome)를 찾지 못했어요. EDGE_PATH 환경 변수에 실행 파일 위치를 적어 주세요.");
  return hit;
}

// 같은 파일이면 늘 같은 값이 나오도록 씨앗이 있는 무작위 수
function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const KO_DATE = (iso) => {
  const [y, m, d] = iso.split("-").map(Number);
  return `${y}년${m}월${d}일`;
};
const addDays = (iso, n) => {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};
// 연습용 가짜 번호라 뒷자리까지 그대로 보여 준다. (실제 열람본은 뒷자리가 가려지지만, 이 앱은 가려진 경우도 읽을 수 있다)
const rrnText = (rrn) => rrn;
const won = (n) => n.toLocaleString("en-US");

const FAKE_DEBTORS = ["한사랑", "오하나", "남세찬", "배도윤", "서지안", "문하람"];
const FAKE_BANKS = ["주식회사샘플은행", "연습새마을금고", "가상신용협동조합"];

function buildHtml(reg, index) {
  const r = rng(index * 7919 + 13);
  const pick = (arr) => arr[Math.floor(r() * arr.length)];
  const lot = reg.lotAddress.value; // 예: "하늘동 4"
  const fullAddress = `가상도 가상시 ${lot}`;
  const road = `가상도 가상시 연습로 ${1 + Math.floor(r() * 9)}길 ${10 + Math.floor(r() * 90)}`;
  const idNo = `${1000 + index}-${2000 + Math.floor(r() * 20)}-${String(100000 + Math.floor(r() * 899999))}`;
  const viewTime = "2026년11월04일 22시10분34초";
  const structure = pick(["벽돌조 기와지붕 단층 주택", "시멘트벽돌조 슬레이트지붕 단층 주택", "조적조 슬래브지붕 단층 주택", "블록조 칼라강판지붕 단층 단독주택"]);
  const area = (25 + Math.floor(r() * 900) / 10).toFixed(2); // 등기처럼 소수 둘째 자리까지
  const firstDate = reg.owners[0].ownershipDate.value;
  const buildDate = addDays(firstDate, -200);
  const TOTAL = 3;

  const header = (n) => `
    <div class="head">${n === 1 ? `<div class="title">등기사항전부증명서(말소사항 포함)<br><span class="sub">- 건물 -</span></div><div class="idno">고유번호 ${idNo}</div>` : ""}
      <div class="addr">[건물] ${fullAddress}</div></div>`;
  const footer = (n) => `<div class="foot">열람일시 : ${viewTime}<span class="pageno">${n}/${TOTAL}</span></div>`;
  const wm = `<div class="wm">열 람 용</div>`;

  // 1쪽: 표제부(건물의 표시) — 일반 단층주택
  const page1 = `<div class="page">${wm}${header(1)}
    <h3>【 표 제 부 】 ( 건물의 표시 )</h3>
    <table><tr><th>표시번호</th><th>접 수</th><th>소재지번 및 건물번호</th><th>건 물 내 역</th><th>등기원인 및 기타사항</th></tr>
    <tr><td>1</td><td>${KO_DATE(buildDate)}</td>
      <td>가상도 가상시 ${lot}<br>[도로명주소]<br>${road}</td>
      <td>${structure}<br>1층 ${area}㎡</td><td></td></tr></table>
    ${footer(1)}</div>`;

  // 2쪽: 갑구(소유권에 관한 사항). 소유자 순서대로 보존/이전 등기가 이어진다.
  let rank = 0;
  const rows = [];
  // 같은 날 함께 소유하게 된 사람들(공유자)은 실제 등기처럼 한 칸에 "공유자 / 지분 N분의 M"으로 묶는다.
  const groups = [];
  for (const o of reg.owners) {
    const g = groups[groups.length - 1];
    if (g && g[0].ownershipDate.value === o.ownershipDate.value) g.push(o);
    else groups.push([o]);
  }
  groups.forEach((group, i) => {
    rank++;
    const date = group[0].ownershipDate.value;
    const cause = addDays(date, -(10 + Math.floor(r() * 30)));
    const price = (30 + Math.floor(r() * 90)) * 1_000_000;
    const holders =
      group.length === 1
        ? `소유자 ${group[0].name.value} ${rrnText(group[0].rrn.value)}<br>${group[0].address.value}`
        : "공유자<br>" + group.map((o) => `지분 ${group.length}분의 1<br>${o.name.value} ${rrnText(o.rrn.value)}<br>${o.address.value}`).join("<br><br>");
    rows.push(`<tr><td>${rank}</td>
      <td>${i === 0 ? "소유권보존" : "소유권이전"}</td>
      <td>${KO_DATE(date)}<br>제${10000 + Math.floor(r() * 80000)}호</td>
      <td>${i === 0 ? "" : `${KO_DATE(cause)}<br>매매`}</td>
      <td>${holders}${i === 0 ? "" : `<br><br>거래가액 금${won(price)}원`}</td></tr>`);
  });
  const page2 = `<div class="page">${wm}${header(2)}
    <h3>【 갑 구 】 ( 소유권에 관한 사항 )</h3>
    <table class="gap"><tr><th>순위번호</th><th>등 기 목 적</th><th>접 수</th><th>등 기 원 인</th><th>권리자 및 기타사항</th></tr>${rows.join("")}</table>
    ${footer(2)}</div>`;

  // 3쪽: 을구(근저당). 채무자·근저당권자 이름은 소유자가 아니므로 읽는 쪽이 무시해야 한다.
  const page3 = `<div class="page">${wm}${header(3)}
    <h3>【 을 구 】 ( 소유권 이외의 권리에 관한 사항 )</h3>
    <table class="gap"><tr><th>순위번호</th><th>등 기 목 적</th><th>접 수</th><th>등 기 원 인</th><th>권리자 및 기타사항</th></tr>
    <tr><td>1</td><td>근저당권설정</td><td>${KO_DATE(addDays(firstDate, 15))}<br>제${10000 + Math.floor(r() * 80000)}호</td><td>${KO_DATE(addDays(firstDate, 15))}<br>설정계약</td>
      <td>채권최고액 금${won((50 + Math.floor(r() * 300)) * 1_000_000)}원<br>채무자 ${pick(FAKE_DEBTORS)}<br>가상도 가상시 시험로 ${1 + Math.floor(r() * 90)}<br><br>근저당권자 ${pick(FAKE_BANKS)} 110111-0000000<br>가상도 가상시 본점로 1</td></tr>
    <tr><td>2</td><td>1번근저당권설정등기말소</td><td>${KO_DATE(addDays(firstDate, 900))}<br>제${10000 + Math.floor(r() * 80000)}호</td><td>${KO_DATE(addDays(firstDate, 900))}<br>해지</td><td></td></tr></table>
    <div class="end">-- 이 하 여 백 --</div>
    <div class="court">관할등기소 가상지방법원 연습등기소</div>
    <p class="note">* 실선으로 그어진 부분은 말소사항을 표시함.<br>* 기록사항 없는 갑구, 을구는 ‘기록사항 없음’으로 표시함.<br>* 본 등기사항증명서는 열람용이므로 출력하신 등기사항증명서는 법적인 효력이 없습니다.</p>
    ${footer(3)}</div>`;

  return `<!doctype html><html lang="ko"><head><meta charset="utf-8"><title>${reg.sourceFile}</title><style>
    @page { size: A4; margin: 12mm; }
    body { font-family: "Malgun Gothic", sans-serif; font-size: 10.5px; color: #111; margin: 0; }
    .page { position: relative; height: 272mm; page-break-after: always; overflow: hidden; }
    .head .title { text-align: center; font-size: 15px; font-weight: bold; margin: 4px 0 10px; }
    .head .sub { font-size: 12px; font-weight: normal; }
    .idno { text-align: right; margin-bottom: 8px; }
    .addr { font-weight: bold; margin: 6px 0 14px; }
    h3 { font-size: 11.5px; margin: 14px 0 6px; }
    table { width: 100%; border-collapse: collapse; margin-bottom: 8px; }
    th, td { border-top: 1px solid #888; border-bottom: 1px solid #888; padding: 4px 6px; text-align: left; vertical-align: top; line-height: 1.55; }
    th { font-weight: normal; background: #f3f3f3; }
    .gap td:nth-child(1) { width: 8%; } .gap td:nth-child(2) { width: 18%; } .gap td:nth-child(5) { width: 38%; }
    .foot { position: absolute; bottom: 0; left: 0; right: 0; border-top: 1px solid #888; padding-top: 4px; }
    .pageno { float: right; }
    .wm { position: absolute; top: 40%; left: 15%; font-size: 90px; letter-spacing: 18px; color: rgba(0,0,0,0.07); transform: rotate(-28deg); white-space: nowrap; z-index: 0; }
    .end { text-align: center; margin: 14px 0; } .court { text-align: right; margin: 40px 0 20px; } .note { line-height: 1.8; }
  </style></head><body>${page1}${page2}${page3}</body></html>`;
}

const edge = findEdge();
let made = 0;
truth.forEach((reg, i) => {
  const base = reg.sourceFile.replace(/\.png$/i, "");
  const htmlPath = path.join(htmlDir, `${base}.html`);
  const pdfPath = path.join(outDir, `${base}.pdf`);
  writeFileSync(htmlPath, buildHtml(reg, i + 1), "utf8");
  execFileSync(
    edge,
    ["--headless=new", "--disable-gpu", "--no-pdf-header-footer", `--print-to-pdf=${pdfPath}`, pathToFileURL(htmlPath).href],
    { stdio: "ignore", timeout: 60_000 },
  );
  made++;
});
for (const f of readdirSync(htmlDir)) rmSync(path.join(htmlDir, f), { force: true });
console.log(`가짜 등기 PDF ${made}건을 만들었어요: ${path.relative(root, outDir)}`);
