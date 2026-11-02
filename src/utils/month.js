// เดือนตามเวลาไทย (UTC+7) — เซิร์ฟเวอร์บน Railway ใช้ UTC จึงห้ามใช้ getMonth() ตรงๆ
const TZ_OFFSET_MS = 7 * 60 * 60 * 1000;
const THAI_MONTHS = ['มกราคม', 'กุมภาพันธ์', 'มีนาคม', 'เมษายน', 'พฤษภาคม', 'มิถุนายน', 'กรกฎาคม', 'สิงหาคม', 'กันยายน', 'ตุลาคม', 'พฤศจิกายน', 'ธันวาคม'];

function thaiYearMonth(date = new Date()) {
  const d = new Date(new Date(date).getTime() + TZ_OFFSET_MS);
  return { year: d.getUTCFullYear(), month: d.getUTCMonth() }; // month 0-11
}

const sameThaiMonth = (a, b) => {
  const x = thaiYearMonth(a);
  const y = thaiYearMonth(b);
  return x.year === y.year && x.month === y.month;
};

module.exports = { THAI_MONTHS, thaiYearMonth, sameThaiMonth };
