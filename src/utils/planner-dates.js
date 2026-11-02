// วันที่ล้วนๆ (ไม่มีเวลา) สำหรับวันสำคัญและ To-Do — คิดตามปฏิทินไทย (UTC+7) ด้วยโค้ดทั้งหมด ไม่พึ่งโมเดล
//   extractDueDate("จองโรงแรม 25 ธ.ค.")   → { text: 'จองโรงแรม', dueDate: '2026-12-25' }
//   extractMonthDay("วันเกิดแฟน 14 มี.ค. 2540") → { text: 'วันเกิดแฟน', day: 14, month: 3, year: 1997 }
const { THAI_MONTHS } = require('./parse-date');

const TZ_OFFSET_MS = 7 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;
const WEEKDAYS = { อาทิตย์: 0, จันทร์: 1, อังคาร: 2, พุธ: 3, พฤหัสบดี: 4, พฤหัส: 4, ศุกร์: 5, เสาร์: 6 };
const MONTH_PAT = Object.keys(THAI_MONTHS).sort((a, b) => b.length - a.length).map((k) => k.replace(/\./g, '\\.')).join('|');

const isLeap = (y) => (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
const daysInMonth = (y, m) => [31, isLeap(y) ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][m - 1];
const validDate = (y, m, d) => m >= 1 && m <= 12 && d >= 1 && d <= daysInMonth(y, m);

const pad = (n) => String(n).padStart(2, '0');
const toIso = (y, m, d) => `${y}-${pad(m)}-${pad(d)}`;
const fromIso = (iso) => { const [y, m, d] = iso.split('-').map(Number); return { y, m, d }; };
const dayNumber = (y, m, d) => Math.round(Date.UTC(y, m - 1, d) / DAY_MS);
const addDays = ({ y, m, d }, n) => { const t = new Date(Date.UTC(y, m - 1, d + n)); return { y: t.getUTCFullYear(), m: t.getUTCMonth() + 1, d: t.getUTCDate() }; };

// วันนี้ตามเวลาไทย
function localToday(now = new Date()) {
  const l = new Date(now.getTime() + TZ_OFFSET_MS);
  return { y: l.getUTCFullYear(), m: l.getUTCMonth() + 1, d: l.getUTCDate(), dow: l.getUTCDay(), hour: l.getUTCHours() };
}

// จำนวนวันจาก a ถึง b (b - a)
const daysBetween = (a, b) => dayNumber(b.y, b.m, b.d) - dayNumber(a.y, a.m, a.d);

const toCe = (year) => (year > 2400 ? year - 543 : year);

function cut(text, m) {
  return `${text.slice(0, m.index)} ${text.slice(m.index + m[0].length)}`.replace(/\s{2,}/g, ' ').trim();
}

// หา "วัน + เดือน [+ ปี]" หรือ "D/M[/YYYY]" ในข้อความ → { day, month, year|null, text } | { error } | null
function extractMonthDay(input) {
  const source = String(input);
  const re = [
    new RegExp(`(?:(?:ภายใน|ก่อน|ถึง)\\s*)?(?:วันที่\\s*)?(\\d{1,2})\\s*(${MONTH_PAT})(?:\\s*(\\d{4}))?`),
    /(?:(?:ภายใน|ก่อน|ถึง)\s*)?(?:วันที่\s*)?(\d{1,2})\/(\d{1,2})(?:\/(\d{4}))?/,
  ];
  for (let i = 0; i < re.length; i += 1) {
    const m = source.match(re[i]);
    if (!m) continue;
    const day = Number(m[1]);
    const month = i === 0 ? THAI_MONTHS[m[2]] : Number(m[2]);
    const year = m[3] ? toCe(Number(m[3])) : null;
    if (!validDate(year || 2024, month, day)) return { error: 'bad_date' };
    return { day, month, year, text: cut(source, m) };
  }
  return null;
}

// วันที่ครบกำหนดของ To-Do จากวลีในข้อความ; ไม่พบวลี → dueDate: null
function extractDueDate(input, now = new Date()) {
  const source = String(input);
  const today = localToday(now);
  const prefix = '(?:ภายใน|ก่อน|ภายในวัน|ถึง)?\\s*';
  const done = (m, target) => ({ text: cut(source, m), dueDate: toIso(target.y, target.m, target.d) });

  let m = source.match(new RegExp(`${prefix}(?:มะรืนนี้|มะรืน)`));
  if (m) return done(m, addDays(today, 2));
  m = source.match(new RegExp(`${prefix}พรุ่งนี้`));
  if (m) return done(m, addDays(today, 1));
  m = source.match(new RegExp(`${prefix}วันนี้`));
  if (m) return done(m, today);

  m = source.match(/อีก\s*(\d{1,3})\s*วัน/);
  if (m) return done(m, addDays(today, Number(m[1])));

  m = source.match(new RegExp(`${prefix}วัน(${Object.keys(WEEKDAYS).join('|')})(\\s*หน้า|\\s*นี้)?`));
  if (m) {
    const dow = WEEKDAYS[m[1]];
    if (m[2] && /หน้า/.test(m[2])) {
      // "ศุกร์หน้า" = วันศุกร์ของสัปดาห์ถัดไป (สัปดาห์เริ่มวันจันทร์)
      const mondayNext = addDays(today, 7 - ((today.dow + 6) % 7));
      return done(m, addDays(mondayNext, (dow + 6) % 7));
    }
    return done(m, addDays(today, ((dow - today.dow + 7) % 7) || 7));
  }

  const md = extractMonthDay(source);
  if (md?.error) return { error: 'bad_date' };
  if (md) {
    let year = md.year || today.y;
    if (!md.year && dayNumber(year, md.month, md.day) < dayNumber(today.y, today.m, today.d)) year += 1;
    if (!validDate(year, md.month, md.day)) return { error: 'bad_date' };
    if (dayNumber(year, md.month, md.day) < dayNumber(today.y, today.m, today.d)) return { error: 'past' };
    return { text: md.text, dueDate: toIso(year, md.month, md.day) };
  }

  return { text: source.trim(), dueDate: null };
}

// วันครบรอบถัดไป (วันนี้นับด้วย) ของวันสำคัญที่วนทุกปี; 29 ก.พ. ในปีที่ไม่มี → 28 ก.พ.
function nextOccurrence(month, day, today) {
  const at = (y) => ({ y, m: month, d: month === 2 && day === 29 && !isLeap(y) ? 28 : day });
  let cand = at(today.y);
  if (daysBetween(today, cand) < 0) cand = at(today.y + 1);
  return cand;
}

module.exports = { localToday, daysBetween, extractDueDate, extractMonthDay, nextOccurrence, fromIso, toIso, addDays, validDate };
