// อ่านวลีบอกวันที่ในข้อความบันทึกค่าใช้จ่าย ("เมื่อวาน", "เมื่อวานซืน", "3 วันก่อน", "วันเสาร์ที่แล้ว")
// คืน { text: ข้อความที่ตัดวลีวันที่ออกแล้ว, createdAt: Date | null }

const DAY_MS = 24 * 60 * 60 * 1000;
const TZ_OFFSET_MS = 7 * 60 * 60 * 1000;

const WEEKDAYS = { อาทิตย์: 0, จันทร์: 1, อังคาร: 2, พุธ: 3, พฤหัสบดี: 4, พฤหัส: 4, ศุกร์: 5, เสาร์: 6 };
const WEEKDAY_RE = new RegExp(`วัน(${Object.keys(WEEKDAYS).join('|')})\\s*(?:ที่แล้ว|ก่อน|ที่ผ่านมา)`);

function thaiWeekday(date) {
  return new Date(date.getTime() + TZ_OFFSET_MS).getUTCDay();
}

function extractDatePhrase(text, now = new Date()) {
  const source = String(text);
  const rules = [
    { re: /เมื่อวานซืน|วานซืน/, days: () => 2 },
    { re: /เมื่อวานนี้|เมื่อวาน|วานนี้/, days: () => 1 },
    { re: /(\d{1,2})\s*วัน(?:ก่อน|ที่แล้ว|ที่ผ่านมา)/, days: (m) => Number(m[1]) },
    { re: WEEKDAY_RE, days: (m) => ((thaiWeekday(now) - WEEKDAYS[m[1]] + 7) % 7) || 7 },
    { re: /วันนี้/, days: () => 0 },
  ];

  for (const { re, days } of rules) {
    const m = source.match(re);
    if (!m) continue;
    const n = days(m);
    if (n > 60) return { text: source, createdAt: null };
    return {
      text: source.replace(re, ' ').replace(/\s{2,}/g, ' ').trim(),
      createdAt: n === 0 ? null : new Date(now.getTime() - n * DAY_MS),
    };
  }
  return { text: source, createdAt: null };
}

module.exports = { extractDatePhrase };
