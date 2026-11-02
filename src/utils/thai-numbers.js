// แปลงตัวเลขที่เขียนเป็นคำไทย ("สามร้อย", "พันนึง", "สองพันห้า") เป็นตัวเลขอารบิก
// เพื่อให้ parser / ตัวตรวจยอดของ NL layer ใช้ต่อได้ — รองรับถึงหลักแสน

const DIGITS = { หนึ่ง: 1, เอ็ด: 1, สอง: 2, ยี่: 2, สาม: 3, สี่: 4, ห้า: 5, หก: 6, เจ็ด: 7, แปด: 8, เก้า: 9, นึง: 1 };
const UNITS = { สิบ: 10, ร้อย: 100, พัน: 1000, หมื่น: 10000, แสน: 100000 };

const D = 'หนึ่ง|เอ็ด|สอง|ยี่|สาม|สี่|ห้า|หก|เจ็ด|แปด|เก้า|นึง';
const U = 'สิบ|ร้อย|พัน|หมื่น|แสน';
const EXPR = new RegExp(`(?:(?:${D})?(?:${U}))+(?:${D})?`, 'g');
const TOKEN = new RegExp(`${D}|${U}`, 'g');

function evaluate(expr) {
  const tokens = expr.match(TOKEN) || [];
  let total = 0;
  let coef = null;
  let lastUnit = 0;

  for (const tok of tokens) {
    if (tok in DIGITS) {
      // "นึง" หลังหน่วยที่ไม่มีตัวเลขนำ (พันนึง = 1,000) ไม่ต้องบวกเพิ่ม
      if (tok === 'นึง' && lastUnit && coef === null) continue;
      coef = DIGITS[tok];
    } else {
      total += (coef ?? 1) * UNITS[tok];
      lastUnit = UNITS[tok];
      coef = null;
    }
  }
  // เลขท้าย: "สองพันห้า" = 2,500, "สามร้อยห้า" = 350 (ตามสำนวนพูด), "สิบเอ็ด" = 11
  if (coef !== null) total += lastUnit >= 100 ? (coef * lastUnit) / 10 : coef;
  return total;
}

function normalizeThaiNumbers(text) {
  return String(text).replace(EXPR, (match, offset, whole) => {
    const startsWithDigitWord = new RegExp(`^(?:${D})`).test(match);
    const next = whole.slice(offset + match.length, offset + match.length + 3);
    // หน่วยลอยๆ (พัน/ร้อย/สิบ) ต้องไม่ใช่ส่วนหนึ่งของคำอื่น เช่น "สายพันธุ์"
    const safeBoundary = !next || !/^[฀-๿]/.test(next) || /^(บาท|นึง|ไป)/.test(next);
    if (!startsWithDigitWord && !safeBoundary) return match;
    const value = evaluate(match);
    return value > 0 ? ` ${value} ` : match;
  }).replace(/[ \t]{2,}/g, ' ').trim();
}

module.exports = { normalizeThaiNumbers };
