// 연습용 가짜 전화번호 엑셀을 만든다. 실제 개인정보는 쓰지 않는다.
// 왜: 전화번호는 등기에 없으므로 "이름-전화번호, 주소-전화번호" 대조 기능을 시험할 별도 엑셀이 필요하다.
// 기존 샘플(fake-sample.json의 엑셀 줄과 등기 소유자)에서 번호를 뽑아, 일부러 다음 경우를 섞는다. 난수 없이 순번으로만 정해 늘 같은 결과가 나온다.
//   - 대부분: 이름·주소·번호가 모두 같음(일부는 하이픈 없는 번호 표기)
//   - 순번 % 9 == 4: 번호가 다름(충돌)
//   - 순번 % 7 == 2: 표기만 다른 번호(01012345678) → 같은 값
//   - 순번 % 11 == 6: 전화번호 엑셀에 기록 없음
//   - 순번 % 13 == 3: 주소만 다르게 적힌 기록(이름만 같음) → 같은 번호면 같음
//   - 새 소유자(엑셀에 없던 사람) 2명: 첫 번째는 이름·주소가 모두 같은 기록(자동 보완), 두 번째는 이름만 같은 기록(후보 → 직원 확인)
// 실행: npm run sample:phone  →  sample-data/fake-phone.xlsx 와 fake-sample.json 의 phones

import fs from "node:fs";
import path from "node:path";
import ExcelJS from "exceljs";

const OUT = path.resolve("sample-data");
const jsonPath = path.join(OUT, "fake-sample.json");
const sample = JSON.parse(fs.readFileSync(jsonPath, "utf8"));

const alterLast = (p) => p.slice(0, -1) + String((Number(p.slice(-1)) + 1) % 10);
const digitsOnly = (p) => p.replace(/\D/g, "");
const typoAddr = (a) => a.replace("연습로", "시험로");

const phones = [];
const knownNames = new Set();
sample.excelRows.forEach((row, k) => {
  const { name, address, phone } = row.fields;
  if (name) knownNames.add(name);
  if (!name || !address || !phone) return;
  if (k % 11 === 6) return; // 전화번호 엑셀에 기록 없음
  let p = phone;
  if (k % 9 === 4) p = alterLast(phone); // 번호가 다름
  else if (k % 7 === 2) p = digitsOnly(phone); // 표기만 다름
  phones.push({ name, address: k % 13 === 3 ? typoAddr(address) : address, phone: p });
});

// 엑셀에 없던 새 소유자(정답표의 new-owner): 등기에서 이름·주소를 가져온다.
const newNames = sample.answerKey.filter((k) => k.kind === "new-owner").map((k) => k.ownerName);
const newOwners = [];
for (const reg of sample.registries) {
  for (const o of reg.owners) {
    if (newNames.includes(o.name.value) && !newOwners.some((x) => x.name === o.name.value)) newOwners.push({ name: o.name.value, address: o.address.value });
  }
}
newOwners.forEach((o, i) => {
  const phone = `010-${7000 + i}-${1000 + i * 7}`;
  if (i === 0) phones.push({ name: o.name, address: o.address, phone }); // 이름·주소 모두 같음 → 자동 보완
  else if (i === 1) phones.push({ name: o.name, address: typoAddr(o.address ?? "") + " 별관", phone }); // 이름만 같음 → 후보
  // 그 밖의 새 소유자는 기록 없음 → 직접 입력
});

const wb = new ExcelJS.Workbook();
const ws = wb.addWorksheet("전화번호");
ws.addRow(["성명", "주소", "전화번호"]);
for (const p of phones) ws.addRow([p.name, p.address, p.phone]);
await wb.xlsx.writeFile(path.join(OUT, "fake-phone.xlsx"));

sample.phones = phones;
fs.writeFileSync(jsonPath, JSON.stringify(sample, null, 2));
console.log(`전화번호 기록 ${phones.length}건 (새 소유자 ${newOwners.length}명 중 ${Math.min(2, newOwners.length)}명 포함)`);
