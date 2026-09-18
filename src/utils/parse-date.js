const THAI_MONTHS = {
  'ม.ค.': 1, 'มกราคม': 1,
  'ก.พ.': 2, 'กุมภาพันธ์': 2,
  'มี.ค.': 3, 'มีนาคม': 3,
  'เม.ย.': 4, 'เมษายน': 4,
  'พ.ค.': 5, 'พฤษภาคม': 5,
  'มิ.ย.': 6, 'มิถุนายน': 6,
  'ก.ค.': 7, 'กรกฎาคม': 7,
  'ส.ค.': 8, 'สิงหาคม': 8,
  'ก.ย.': 9, 'กันยายน': 9,
  'ต.ค.': 10, 'ตุลาคม': 10,
  'พ.ย.': 11, 'พฤศจิกายน': 11,
  'ธ.ค.': 12, 'ธันวาคม': 12,
};

const MONTH_LABELS = ['', 'ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.', 'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.'];

const TZ_OFFSET_H = 7;

function thaiToUtc(yr, mon, day, h, min) {
  return new Date(Date.UTC(yr, mon - 1, day, h - TZ_OFFSET_H, min, 0));
}

// Parse LINE datetimepicker value "YYYY-MM-DDThh:mm" (Thailand time) → UTC Date
function parseDatetimePickerValue(value) {
  const [datePart, timePart] = value.split('T');
  const [yr, mon, day] = datePart.split('-').map(Number);
  const [h, min] = timePart.split(':').map(Number);
  return thaiToUtc(yr, mon, day, h, min);
}

function toLocalDisplay(utcDate) {
  const local = new Date(utcDate.getTime() + TZ_OFFSET_H * 60 * 60 * 1000);
  const d = local.getUTCDate();
  const m = local.getUTCMonth() + 1;
  const h = String(local.getUTCHours()).padStart(2, '0');
  const min = String(local.getUTCMinutes()).padStart(2, '0');
  return `${d} ${MONTH_LABELS[m]} ${h}:${min}`;
}

function buildThaiPattern() {
  const keys = Object.keys(THAI_MONTHS).sort((a, b) => b.length - a.length);
  return keys.map((k) => k.replace(/\./g, '\\.')).join('|');
}

// Returns { scheduledAt: Date (UTC), message: string } or null
function parseNotificationInput(input) {
  const monthPat = buildThaiPattern();

  // Thai month: "DD MonthName [YYYY] HH:MM message"
  const thaiRe = new RegExp(`^(\\d{1,2})\\s+(${monthPat})(?:\\s+(\\d{4}))?\\s+(\\d{1,2}:\\d{2})\\s+(.+)$`);
  let m = input.match(thaiRe);
  if (m) {
    const day = parseInt(m[1]);
    const mon = THAI_MONTHS[m[2]];
    let yr = m[3] ? parseInt(m[3]) : new Date().getFullYear();
    if (yr > 2500) yr -= 543;
    const [h, min] = m[4].split(':').map(Number);
    const message = m[5].trim();

    let scheduledAt = thaiToUtc(yr, mon, day, h, min);
    if (!m[3] && scheduledAt < new Date()) {
      scheduledAt = thaiToUtc(yr + 1, mon, day, h, min);
    }
    return { scheduledAt, message };
  }

  // Numeric: "DD/MM HH:MM message" or "DD/MM/YYYY HH:MM message"
  const numRe = /^(\d{1,2})\/(\d{1,2})(?:\/(\d{4}))?\s+(\d{1,2}:\d{2})\s+(.+)$/;
  m = input.match(numRe);
  if (m) {
    const day = parseInt(m[1]);
    const mon = parseInt(m[2]);
    let yr = m[3] ? parseInt(m[3]) : new Date().getFullYear();
    if (yr > 2500) yr -= 543;
    const [h, min] = m[4].split(':').map(Number);
    const message = m[5].trim();

    let scheduledAt = thaiToUtc(yr, mon, day, h, min);
    if (!m[3] && scheduledAt < new Date()) {
      scheduledAt = thaiToUtc(yr + 1, mon, day, h, min);
    }
    return { scheduledAt, message };
  }

  return null;
}

module.exports = { parseNotificationInput, toLocalDisplay, parseDatetimePickerValue };
