// 연습용 가짜(샘플) 데이터를 만든다. 실제 등기·사내 데이터는 절대 쓰지 않는다.
// 왜: 항상 같은 결과가 나오도록 고정된 난수(seed)로 만들어, 정답표와 비교해 성공 기준을 잴 수 있게 한다.
// 실행: npm run sample  →  sample-data/fake-sample.json, fake-existing.xlsx, fake-city-billing.xlsx

import fs from "node:fs";
import path from "node:path";
import ExcelJS from "exceljs";

const OUT = path.resolve("sample-data");
fs.mkdirSync(OUT, { recursive: true });

// ── 고정 난수 ──
function mulberry32(seed) {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
let R = mulberry32(20261104);
const int = (a, b) => a + Math.floor(R() * (b - a + 1));
const pick = (arr) => arr[Math.floor(R() * arr.length)];
const pad = (n, w = 2) => String(n).padStart(w, "0");
const iso = (y, m, d) => `${y}-${pad(m)}-${pad(d)}`;
const addYears = (s, n) => {
  const [y, m, d] = s.split("-").map(Number);
  return iso(y + n, m, Math.min(d, 28));
};
const parts = (s) => s.split("-").map(Number);

const SURNAMES = ["김", "이", "박", "최", "정", "강", "조", "윤", "장", "임"];
const GIVEN = ["가온", "나래", "다솜", "라온", "마루", "보람", "새봄", "아름", "이든", "하늘", "누리", "도담", "소담", "여름", "지안", "시온", "해든", "바다", "구름", "달래"];
const DONGS = ["새솔동", "한빛동", "푸른동", "별빛동", "하늘동", "가온동"];

const usedLots = new Set();
const usedNames = new Set();
function newName() {
  let n;
  do n = pick(SURNAMES) + pick(GIVEN);
  while (usedNames.has(n));
  usedNames.add(n);
  return n;
}
function newLot() {
  let l;
  do l = `${pick(DONGS)} ${int(1, 120)}${R() < 0.5 ? `-${int(1, 9)}` : ""}`;
  while (usedLots.has(l));
  usedLots.add(l);
  return l;
}
const newRrn = () => `${pad(int(50, 95))}${pad(int(1, 12))}${pad(int(1, 28))}-${pick([1, 2])}${pad(int(0, 999999), 6)}`;
const newPhone = () => `010-${int(1000, 9999)}-${int(1000, 9999)}`;
const newAddr = () => `가상시 샘플구 연습로 ${int(1, 9)}길 ${int(1, 50)}`;
const newOwner = (own, end) => ({
  name: newName(), rrn: newRrn(), address: newAddr(), phone: newPhone(), ownershipDate: own, ownershipEndDate: end,
});

// ── 30개 지번 만들기 ──
// 0~15: 소유자 1명 / 16~23: 소유자 교체(2~3명) / 24~29: 공유자(2~3명)
const lots = [];
const city = [];
// 점유면적(㎡): 구청 엑셀에 있다고 가정한 무작위 값. 난수 흐름을 바꾸지 않도록 번호로 계산한다(다른 샘플 값이 달라지지 않게).
const areaOf = (i) => (((i * 7919) % 2300 + 150) / 10).toFixed(1);
for (let i = 0; i < 30; i++) {
  const lotAddress = newLot();
  let owners;
  if (i < 16) {
    owners = [newOwner(iso(int(2008, 2024), int(1, 12), int(1, 28)), null)];
  } else if (i < 24) {
    const count = i === 22 || i === 23 ? 3 : 2;
    const d0 = iso(int(2006, 2012), int(1, 12), int(1, 28));
    const dates = [d0];
    for (let k = 1; k < count; k++) dates.push(addYears(dates[k - 1], int(3, 6)));
    owners = dates.map((d, k) => newOwner(d, k + 1 < count ? dates[k + 1] : null));
  } else {
    const count = i >= 28 ? 3 : 2;
    const d = iso(int(2010, 2022), int(1, 12), int(1, 28));
    owners = Array.from({ length: count }, () => newOwner(d, null));
  }
  let lastBilling = null;
  if (i % 4 !== 3) {
    let end = iso(int(2021, 2024), int(1, 12), int(1, 28));
    if (end <= owners[0].ownershipDate) end = addYears(owners[0].ownershipDate, 1);
    lastBilling = end;
    city.push({ lotAddress, ownerName: owners[0].name, startDate: owners[0].ownershipDate, endDate: end, occupiedArea: areaOf(i) });
  }
  lots.push({ index: i, lotAddress, owners, lastBilling, area: areaOf(i), file: `fake-registry-${pad(i + 1)}.png` });
}

// ── 등기 읽기 결과(정답) ──
const rv = (value, confidence = int(94, 99)) => ({ value, confidence });
const toReading = (lot) => ({
  sourceFile: lot.file,
  lotAddress: rv(lot.lotAddress),
  owners: lot.owners.map((o) => ({
    name: rv(o.name), rrn: rv(o.rrn), address: rv(o.address),
    ownershipDate: rv(o.ownershipDate), ownershipEndDate: rv(o.ownershipEndDate, 99),
  })),
});
const registries = lots.map(toReading);
const registryRounds = {};
for (const r of registries) registryRounds[r.sourceFile] = [structuredClone(r), structuredClone(r), structuredClone(r)];

// ── 기존 엑셀 만들기 ──
const excel = lots.map((lot) =>
  lot.owners.map((o) => ({
    lotAddress: lot.lotAddress,
    fields: {
      name: o.name, phone: o.phone, address: o.address, rrn: o.rrn,
      occupiedArea: lot.index % 2 === 0 ? lot.area : null, // 짝수 번호 지번은 엑셀에 이미 있고, 홀수는 빈칸(구청 엑셀로 보완)
      ownershipDate: o.ownershipDate, ownershipEndDate: o.ownershipEndDate,
      lastBillingEndDate: lot.lastBilling, billingStartDate: null, billingEndDate: null,
    },
  })),
);

// ── 일부러 섞는 오류·빈칸 (정답표) ──
const answerKey = [];
const note = (i, k, field, kind, expectedStatus, correctValue = null) =>
  answerKey.push({ lotAddress: lots[i].lotAddress, ownerName: lots[i].owners[k].name, field, kind, expectedStatus, correctValue });

const alterRrn = (r) => r.slice(0, -1) + String((Number(r.slice(-1)) + 1) % 10);
const alterAddr = (a) => a.replace("연습로", "시험로");
const alterDate = (d) => addYears(d, 1);
const dotted = (d) => { const [y, m, dd] = parts(d); return `${y}. ${m}. ${dd}.`; };
const korean = (d) => { const [y, m, dd] = parts(d); return `${y}년 ${m}월 ${dd}일`; };
const compact = (d) => d.replaceAll("-", "");

// (1) 빈칸 → 자동 보완돼야 함
for (const [i, f] of [[1, "rrn"], [3, "address"], [5, "ownershipDate"], [7, "name"], [9, "address"], [11, "rrn"]]) {
  excel[i][0].fields[f] = null;
  note(i, 0, f, "blank", "filled", lots[i].owners[0][f]);
}
// (2) 값이 다름 → 충돌 목록에 가야 함
for (const [i, f, fn] of [[2, "rrn", alterRrn], [4, "address", alterAddr], [6, "ownershipDate", alterDate], [10, "rrn", alterRrn], [12, "ownershipDate", alterDate], [14, "address", alterAddr]]) {
  excel[i][0].fields[f] = fn(lots[i].owners[0][f]);
  note(i, 0, f, "conflict", "conflict", lots[i].owners[0][f]);
}
excel[8][0].fields.ownershipEndDate = addYears(lots[8].owners[0].ownershipDate, 2); // 현재 소유자인데 종료일이 적힘
note(8, 0, "ownershipEndDate", "conflict", "conflict", null);
excel[18][0].fields.ownershipEndDate = addYears(lots[18].owners[0].ownershipEndDate, 1);
note(18, 0, "ownershipEndDate", "conflict", "conflict", lots[18].owners[0].ownershipEndDate);
// (3) 표기만 다름 → 같은 값으로 봐야 함 (충돌로 잡으면 오탐)
const formatCases = [
  [13, null, () => {}], // 지번주소 표기만 다름(아래서 처리)
  [15, "ownershipDate", dotted], [17, "name", (n) => `${n[0]} ${n.slice(1)}`],
  [19, "address", (a) => a.replaceAll(" ", ", ")], [20, "rrn", (r) => r.replace("-", "")],
  [21, "ownershipDate", korean], [25, "rrn", (r) => r.replace("-", "")],
  [26, "address", (a) => a.replaceAll(" ", "  ")], [27, "ownershipDate", compact],
  [29, "name", (n) => `${n[0]} ${n.slice(1)}`],
];
for (const [i, f, fn] of formatCases) {
  if (f) excel[i][0].fields[f] = fn(lots[i].owners[0][f]);
  else excel[i].forEach((row) => { row.lotAddress = row.lotAddress.replace(" ", "  "); });
  note(i, 0, f ?? "name", "format-same", "same", null);
}
// (3-2) 점유면적: 빈칸 보완 / 구청 엑셀과 다름(충돌) / 표기만 다름(같은 값)
for (const i of [1, 5, 9]) note(i, 0, "occupiedArea", "blank", "filled", lots[i].area); // 엑셀 값이 이미 빈칸
excel[18][1].fields.occupiedArea = String((Number(lots[18].area) + 1).toFixed(1));
note(18, 1, "occupiedArea", "conflict", "conflict", lots[18].area);
excel[20][1].fields.occupiedArea = `${lots[20].area}0`;
note(20, 1, "occupiedArea", "format-same", "same", null);
// (4) 등기에는 있는데 엑셀에 없는 새 소유자 → 줄 추가(보완)
for (const i of [16, 22]) {
  const k = lots[i].owners.length - 1;
  excel[i].splice(k, 1);
  note(i, k, "name", "new-owner", "filled", lots[i].owners[k].name);
}
// (5) 엑셀에만 있는 줄 → 확인 필요
const orphan = newOwner("2018-05-05", null);
const orphanRow = {
  lotAddress: "임시동 99-9",
  fields: { name: orphan.name, phone: orphan.phone, address: orphan.address, rrn: orphan.rrn, occupiedArea: null, ownershipDate: orphan.ownershipDate, ownershipEndDate: null, lastBillingEndDate: null, billingStartDate: null, billingEndDate: null },
};
answerKey.push({ lotAddress: orphanRow.lotAddress, ownerName: orphan.name, field: "name", kind: "orphan", expectedStatus: "needs-check", correctValue: null });
// (6) 읽은 글자 확신도가 낮음(90% 미만) → 확인 필요 (엑셀 값도 일부러 틀리게)
for (const [i, k, f, conf, fn] of [[0, 0, "address", 78, alterAddr], [23, 1, "ownershipDate", 70, alterDate], [28, 0, "rrn", 80, alterRrn]]) {
  excel[i][k].fields[f] = fn(lots[i].owners[k][f]);
  for (const round of registryRounds[lots[i].file]) round.owners[k][f].confidence = conf;
  note(i, k, f, "low-confidence", "needs-check", lots[i].owners[k][f]);
}
// (7) 회차마다 읽은 값이 달라짐 → 3회 후에도 달라지면 확인 필요
{
  const i = 24;
  const rounds = registryRounds[lots[i].file];
  rounds[1].owners[0].address.value = lots[i].owners[0].address.replace("연습로", "연습로 8").replace(/ \d+길/, "길");
  rounds[2].owners[0].address.value = lots[i].owners[0].address.replace("연습로", "연습로 9").replace(/ \d+길/, "길");
  note(i, 0, "address", "unstable", "needs-check", lots[i].owners[0].address);
}
// (8) 1회 읽기만 틀리고 2~3회에서 안정 → 3회까지 가지만 문제 없음
registryRounds[lots[13].file][0].owners[0].name.value = lots[13].owners[0].name.slice(0, 1) + "?";

// ── 사례 모음: 30~99번 지번(70건) ──
// 왜: 부과 기간은 소유자 교체·구청 부과 종료일(용도폐지 시점)·주말·공유자 같은 조합마다 결과가 달라서 사례가 다양해야 한다.
// 앞의 30건은 그대로 두고(난수 흐름을 바꾸지 않으려고 새 씨앗을 쓴다), 아래 사례를 하나씩 일부러 만든다.
R = mulberry32(20261105);
const DAY = 86400000;
const addD = (d, n) => new Date(Date.parse(d + "T00:00:00Z") + n * DAY).toISOString().slice(0, 10);
const wdOf = (d) => new Date(d + "T00:00:00Z").getUTCDay(); // 0=일 … 6=토
const toWeekday = (d, target) => { let x = d; while (wdOf(x) !== target) x = addD(x, -1); return x; };
const rndDate = (y1, y2) => iso(int(y1, y2), int(1, 12), int(1, 28));
const rndBetween = (a, b) => addD(a, int(0, Math.max(0, Math.round((Date.parse(b) - Date.parse(a)) / DAY))));

const cases = [];
const addCases = (n, tag, build) => { for (let j = 0; j < n; j++) cases.push({ tag, build: () => build(j) }); };

// A. 구청 마지막 부과 종료일(용도폐지) 뒤에 소유자가 바뀜 → 두 사람에게 기간을 나눠 부과 (마지막 부과일이 금·토요일인 경우 포함)
addCases(12, "A 구청 종료 이후 소유자 교체(기간 분할 2명)", (j) => {
  let L = rndBetween("2023-02-01", "2024-06-30");
  if (j % 3 === 0) L = toWeekday(L, 5); else if (j % 3 === 1) L = toWeekday(L, 6);
  const T = addD(L, int(30, 400));
  const own1 = rndDate(2005, 2018);
  return { owners: [newOwner(own1, T), newOwner(T, null)], L, city: [[0, own1, L]] };
});
// B. 소유자가 두 번 바뀜, 구청 종료일이 첫 교체보다 앞 → 세 사람 모두에게 나눠 부과
addCases(5, "B 연쇄 교체 3명 모두 부과", () => {
  const L = rndBetween("2021-06-01", "2023-06-30");
  const T1 = addD(L, int(60, 300));
  const T2 = addD(T1, int(200, 400));
  const own1 = rndDate(2005, 2018);
  return { owners: [newOwner(own1, T1), newOwner(T1, T2), newOwner(T2, null)], L, city: [[0, own1, L]] };
});
// C. 구청 종료일이 첫 교체와 둘째 교체 사이 → 첫 소유자는 부과 대상 아님, 둘째·셋째에게 나눠 부과
addCases(5, "C 교체 사이에 구청 종료(첫 소유자 제외)", () => {
  const T1 = rndBetween("2019-01-01", "2021-06-30");
  const L = addD(T1, int(100, 400));
  const T2 = addD(L, int(50, 400));
  const own1 = rndDate(2005, 2016);
  return { owners: [newOwner(own1, T1), newOwner(T1, T2), newOwner(T2, null)], L, city: [[0, own1, L]] };
});
// K. 같은 지번에 구청 부과 이력이 여러 건(소유자별로 나뉘어 부과됨) → 가장 늦은 종료일이 기준
addCases(5, "K 구청 이력 여러 건", () => {
  const T1 = rndBetween("2018-01-01", "2020-06-30");
  const L = addD(T1, int(200, 700));
  const T2 = addD(L, int(50, 400));
  const own1 = rndDate(2005, 2015);
  return { owners: [newOwner(own1, T1), newOwner(T1, T2), newOwner(T2, null)], L, city: [[0, own1, addD(T1, -1)], [1, T1, L]] };
});
// D. 무단점유자가 국유지를 물고 있는 건물을 오래 보유 중 용도폐지됨 → 건물 소유기간은 긴데 부과는 용도폐지(구청 마지막 부과일) 이후만
addCases(12, "D 소유기간은 긴데 부과는 용도폐지 이후", (j) => {
  const own = rndDate(1985, 2004);
  let L = rndBetween("2024-01-01", "2025-09-30");
  L = toWeekday(L, [5, 6, 0, 4][j % 4]); // 금·토·일·목
  return { owners: [newOwner(own, null)], L, city: [[0, own, L]] };
});
// E. 구청 부과 이력이 없음 → 소유권이전일부터
addCases(4, "E1 이력 없음 단독", () => ({ owners: [newOwner(rndDate(2012, 2025), null)], L: null, city: [] }));
addCases(3, "E2 이력 없음 + 교체", () => {
  const own1 = rndDate(2008, 2016);
  const T = rndDate(2018, 2024);
  return { owners: [newOwner(own1, T), newOwner(T, null)], L: null, city: [] };
});
// F. 공유자: 각자 따로 계산 / 공유자가 단독 소유자에게 이전
addCases(3, "F1 공유자 2~3명", (j) => {
  const d = rndDate(2005, 2020);
  const L = rndBetween("2023-01-01", "2025-06-30");
  const owners = Array.from({ length: 2 + (j % 2) }, () => newOwner(d, null));
  return { owners, L, city: [[0, d, L]] };
});
addCases(4, "F2 공유자 → 단독 이전", (j) => {
  const d0 = rndDate(2005, 2018);
  const T = rndBetween("2022-01-01", "2024-12-31");
  const L = j % 2 === 0 ? addD(T, -int(40, 300)) : addD(T, int(40, 300)); // 짝수: 구청 종료가 이전 앞(분할), 홀수: 이전 뒤
  return { owners: [newOwner(d0, T), newOwner(d0, T), newOwner(T, null)], L, city: [[0, d0, L]] };
});
// G. 경계 사례
cases.push({ tag: "G1 소유권이전일 = 구청 종료일 다음 날", build: () => {
  const L = toWeekday("2024-03-14", 3); const own = addD(L, 1);
  return { owners: [newOwner(own, null)], L, city: [[0, addD(L, -400), L]] };
} });
cases.push({ tag: "G2 소유권이전일 = 구청 종료일", build: () => {
  const L = toWeekday("2024-05-16", 4);
  return { owners: [newOwner(L, null)], L, city: [[0, addD(L, -400), L]] };
} });
cases.push({ tag: "G3 소유자 교체일 = 구청 종료일 다음 날", build: () => {
  const L = toWeekday("2023-09-14", 2); const T = addD(L, 1); const own1 = rndDate(2006, 2016);
  return { owners: [newOwner(own1, T), newOwner(T, null)], L, city: [[0, own1, L]] };
} });
cases.push({ tag: "G4 소유자 교체일 = 구청 종료일", build: () => {
  const L = toWeekday("2023-11-16", 4); const own1 = rndDate(2006, 2016);
  return { owners: [newOwner(own1, L), newOwner(L, null)], L, city: [[0, own1, L]] };
} });
cases.push({ tag: "G5 소유권이전일이 토요일(이력 없음)", build: () => {
  const own = toWeekday("2019-07-20", 6);
  return { owners: [newOwner(own, null)], L: null, city: [] };
} });
cases.push({ tag: "G6 구청 종료일이 금요일이고 교체일이 다음 월요일", build: () => {
  const L = toWeekday("2024-02-23", 5); const T = addD(L, 3); const own1 = rndDate(2006, 2016);
  return { owners: [newOwner(own1, T), newOwner(T, null)], L, city: [[0, own1, L]] };
} });
// H. 구청이 이미 오늘 이후까지 부과함
cases.push({ tag: "H1 구청이 2026-12-31까지 부과", build: () => {
  const own = rndDate(2010, 2020);
  return { owners: [newOwner(own, null)], L: "2026-12-31", city: [[0, own, "2026-12-31"]] };
} });
cases.push({ tag: "H2 구청이 2026-11-05까지 부과", build: () => {
  const own = rndDate(2010, 2020);
  return { owners: [newOwner(own, null)], L: "2026-11-05", city: [[0, own, "2026-11-05"]] };
} });
// 일반 단독 소유(부과 이력 있음)
addCases(9, "P 일반 단독", () => {
  const own = rndDate(2008, 2022);
  const L = rndBetween(addD(own, 400), "2025-12-31");
  return { owners: [newOwner(own, null)], L, city: [[0, own, L]] };
});

const caseCounts = {};
cases.forEach((c, j) => {
  const i = 30 + j;
  const spec = c.build();
  const lotAddress = newLot();
  const lot = { index: i, lotAddress, owners: spec.owners, lastBilling: spec.L, area: areaOf(i), file: `fake-registry-${pad(i + 1)}.png` };
  lots.push(lot);
  for (const [idx, st, en] of spec.city) {
    city.push({ lotAddress, ownerName: lot.owners[idx].name, startDate: st, endDate: en, occupiedArea: lot.area });
  }
  const reg = toReading(lot);
  registries.push(reg);
  registryRounds[lot.file] = [structuredClone(reg), structuredClone(reg), structuredClone(reg)];
  excel.push(lot.owners.map((o) => ({
    lotAddress,
    fields: {
      name: o.name, phone: o.phone, address: o.address, rrn: o.rrn,
      occupiedArea: i % 2 === 0 ? lot.area : null,
      ownershipDate: o.ownershipDate, ownershipEndDate: o.ownershipEndDate,
      lastBillingEndDate: lot.lastBilling, billingStartDate: null, billingEndDate: null,
    },
  })));
  caseCounts[c.tag] = (caseCounts[c.tag] ?? 0) + 1;
});

// 새 지번에도 오류·빈칸을 섞는다(정답표). 10개마다 같은 모양이 반복된다.
for (let j = 0; j < cases.length; j++) {
  const i = 30 + j;
  const lot = lots[i];
  const o = lot.owners[0];
  switch (j % 10) {
    case 0: excel[i][0].fields.rrn = null; note(i, 0, "rrn", "blank", "filled", o.rrn); break;
    case 1: excel[i][0].fields.address = alterAddr(o.address); note(i, 0, "address", "conflict", "conflict", o.address); break;
    case 2: excel[i][0].fields.rrn = alterRrn(o.rrn); note(i, 0, "rrn", "conflict", "conflict", o.rrn); break;
    case 3: excel[i][0].fields.address = null; note(i, 0, "address", "blank", "filled", o.address); break;
    case 4: excel[i][0].fields.ownershipDate = alterDate(o.ownershipDate); note(i, 0, "ownershipDate", "conflict", "conflict", o.ownershipDate); break;
    case 5: excel[i][0].fields.ownershipDate = dotted(o.ownershipDate); note(i, 0, "ownershipDate", "format-same", "same", null); break;
    case 7: excel[i][0].fields.rrn = o.rrn.replace("-", ""); note(i, 0, "rrn", "format-same", "same", null); break;
    case 8: {
      const k = lot.owners.length - 1;
      excel[i][k].fields.address = alterAddr(lot.owners[k].address);
      note(i, k, "address", "conflict", "conflict", lot.owners[k].address);
      break;
    }
    default: break;
  }
}
// 소유자가 여럿인 지번 일부는 마지막 소유자가 엑셀에 없음(등기에만 있는 새 소유자 → 줄 추가)
for (let j = 7; j < cases.length; j += 14) {
  const i = 30 + j;
  if (lots[i].owners.length < 2) continue;
  const k = lots[i].owners.length - 1;
  excel[i].splice(k, 1);
  note(i, k, "name", "new-owner", "filled", lots[i].owners[k].name);
}
const caseList = cases.map((c, j) => ({ lotAddress: lots[30 + j].lotAddress, tag: c.tag }));
console.log("추가 사례", cases.length, "건:", JSON.stringify(caseCounts));

// ── 파일로 저장 ──
const excelRows = [];
for (const rows of excel) {
  rows.forEach((row, idx) => excelRows.push({ rowId: { lotAddress: row.lotAddress, ownerIndex: idx + 1 }, fields: row.fields }));
}
excelRows.push({ rowId: { lotAddress: orphanRow.lotAddress, ownerIndex: 1 }, fields: orphanRow.fields });

// 등기 그림에 그릴 글자(정답 기준). 그림은 scripts/make-register-images.ps1 이 이 글자로 만든다.
const registryLines = {};
for (const lot of lots) {
  const lines = ["등기사항전부증명서 (연습용 가짜)", `지번주소 : ${lot.lotAddress}`, "[갑구] 소유권에 관한 사항"];
  lot.owners.forEach((o, k) => {
    lines.push(`${k + 1}. 성명 : ${o.name}   주민등록번호 : ${o.rrn}`);
    lines.push(`   주소 : ${o.address}`);
    lines.push(`   소유권이전일 : ${o.ownershipDate}   소유종료일 : ${o.ownershipEndDate ?? "-"}`);
  });
  registryLines[lot.file] = lines;
}

const sample = {
  note: "연습용 가짜 데이터입니다. 실제 등기·개인정보가 아닙니다.",
  registries, registryRounds, registryLines, excelRows, city, answerKey,
  // 30번째 이후 지번이 어떤 부과 사례인지(시험이 사례별로 결과를 확인하는 데 쓴다)
  cases: caseList,
};
fs.writeFileSync(path.join(OUT, "fake-sample.json"), JSON.stringify(sample, null, 2), "utf8");

const HEADERS = ["지번주소", "성명", "전화번호", "주소", "주민등록번호", "점유면적(㎡)", "소유권이전일", "소유종료일", "구청 마지막 부과 종료일", "부과 시작일", "부과 종료일"];
const wbExisting = new ExcelJS.Workbook();
const ws = wbExisting.addWorksheet("기존엑셀");
ws.addRow(HEADERS);
for (const r of excelRows) {
  const f = r.fields;
  ws.addRow([r.rowId.lotAddress, f.name, f.phone, f.address, f.rrn, f.occupiedArea, f.ownershipDate, f.ownershipEndDate, f.lastBillingEndDate, f.billingStartDate, f.billingEndDate]);
}
await wbExisting.xlsx.writeFile(path.join(OUT, "fake-existing.xlsx"));

const wbCity = new ExcelJS.Workbook();
const wc = wbCity.addWorksheet("구청부과이력");
wc.addRow(["지번주소", "성명", "점유면적(㎡)", "부과 시작일", "부과 종료일"]);
for (const c of city) wc.addRow([c.lotAddress, c.ownerName, c.occupiedArea, c.startDate, c.endDate]);
await wbCity.xlsx.writeFile(path.join(OUT, "fake-city-billing.xlsx"));

const kinds = answerKey.reduce((m, a) => ({ ...m, [a.kind]: (m[a.kind] ?? 0) + 1 }), {});
console.log(`지번 ${lots.length}개, 엑셀 ${excelRows.length}줄, 구청 이력 ${city.length}건, 정답표 ${answerKey.length}건`, kinds);
