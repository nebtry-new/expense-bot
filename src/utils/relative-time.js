// อ่านเวลาแบบพูดของคนไทยสำหรับตั้งแจ้งเตือน (เวลาไทย UTC+7):
//   "พรุ่งนี้บ่ายสามซื้อนม", "วันศุกร์หน้า 9 โมงเช้า โทรหาแม่", "อีก 2 ชั่วโมง ออกจากบ้าน", "20.30 กินยา"
// คืน { scheduledAt: Date (UTC), message } | { error } | null (ไม่พบวลีเวลา)

const TZ_OFFSET_MS = 7 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

const WORD_NUM = { สิบเอ็ด: 11, สิบสอง: 12, สิบ: 10, หนึ่ง: 1, เอ็ด: 1, สอง: 2, สาม: 3, สี่: 4, ห้า: 5, หก: 6, เจ็ด: 7, แปด: 8, เก้า: 9 };
const NUM = '(?:\\d{1,2}|สิบเอ็ด|สิบสอง|สิบ|หนึ่ง|เอ็ด|สอง|สาม|สี่|ห้า|หก|เจ็ด|แปด|เก้า)';
const WEEKDAYS = { อาทิตย์: 0, จันทร์: 1, อังคาร: 2, พุธ: 3, พฤหัสบดี: 4, พฤหัส: 4, ศุกร์: 5, เสาร์: 6 };

const toNum = (s) => (/^\d+$/.test(s) ? Number(s) : WORD_NUM[s]);

function localParts(date) {
  const l = new Date(date.getTime() + TZ_OFFSET_MS);
  return { y: l.getUTCFullYear(), m: l.getUTCMonth(), d: l.getUTCDate(), dow: l.getUTCDay(), h: l.getUTCHours(), min: l.getUTCMinutes() };
}

const toUtc = (y, m, d, h, min) => new Date(Date.UTC(y, m, d, h, min) - TZ_OFFSET_MS);

// ตัดข้อความที่ match ออก คืน [match, text ที่เหลือ]
function take(text, re) {
  const m = text.match(re);
  return m ? [m, text.replace(re, ' ')] : [null, text];
}

function extractTime(text) {
  let m;
  let rest = text;
  const half = (r) => (/ครึ่ง/.test(r) ? 30 : 0);

  [m, rest] = take(text, /(\d{1,2})[:.](\d{2})\s*(?:น\.?)?/);
  if (m) return { h: Number(m[1]), min: Number(m[2]), rest };

  [m, rest] = take(text, /เที่ยงคืน/);
  if (m) return { h: 0, min: 0, rest, nextDay: true };
  [m, rest] = take(text, /เที่ยง(?:วัน)?(ครึ่ง)?/);
  if (m) return { h: 12, min: half(m[0]), rest };

  [m, rest] = take(text, new RegExp(`บ่าย\\s*(โมง|${NUM})?\\s*(?:โมง)?\\s*(ครึ่ง)?`));
  if (m) {
    const n = !m[1] || m[1] === 'โมง' ? 1 : toNum(m[1]);
    return { h: n <= 6 ? n + 12 : n, min: half(m[0]), rest };
  }

  [m, rest] = take(text, new RegExp(`(?:เย็น|ตอนเย็น)\\s*(${NUM})\\s*(?:โมง)?\\s*(ครึ่ง)?|(${NUM})\\s*โมงเย็น\\s*(ครึ่ง)?`));
  if (m) {
    const n = toNum(m[1] || m[3]);
    return { h: n < 12 ? n + 12 : n, min: half(m[0]), rest };
  }

  [m, rest] = take(text, new RegExp(`(${NUM})?\\s*ทุ่ม\\s*(ครึ่ง)?`));
  if (m) {
    const n = m[1] ? toNum(m[1]) : 1;
    return { h: n + 18, min: half(m[0]), rest };
  }

  [m, rest] = take(text, new RegExp(`ตี\\s*(${NUM})\\s*(ครึ่ง)?`));
  if (m) return { h: toNum(m[1]), min: half(m[0]), rest };

  [m, rest] = take(text, new RegExp(`(${NUM})\\s*โมง(?:เช้า)?\\s*(ครึ่ง)?`));
  if (m) {
    const n = toNum(m[1]);
    const morning = /เช้า/.test(m[0]);
    return { h: !morning && n >= 1 && n <= 5 ? n + 12 : n, min: half(m[0]), rest };
  }

  [m, rest] = take(text, /(?:ตอน)?เช้า/);
  if (m) return { h: 8, min: 0, rest };

  return null;
}

function parseRelativeReminder(input, now = new Date()) {
  let text = String(input || '').replace(/\s+/g, ' ').trim();
  if (!text) return null;
  const nowLocal = localParts(now);
  let m;

  // 1) offset จากตอนนี้: "อีก 2 ชั่วโมง", "อีกครึ่งชั่วโมง", "อีก 3 วัน"
  let offsetMs = null;
  [m, text] = take(text, /อีกครึ่งชั่วโมง/);
  if (m) offsetMs = 30 * 60 * 1000;
  if (offsetMs === null) {
    [m, text] = take(text, new RegExp(`อีก\\s*(${NUM})?\\s*(ชั่วโมง|ชม\\.?|นาที|วัน)`));
    if (m) {
      const n = m[1] ? toNum(m[1]) : 1;
      offsetMs = n * ({ ชั่วโมง: 3600000, 'ชม.': 3600000, ชม: 3600000, นาที: 60000, วัน: DAY_MS }[m[2]]);
    }
  }
  if (offsetMs !== null) {
    const message = cleanMessage(text);
    if (!message) return { error: 'no_message' };
    return { scheduledAt: new Date(now.getTime() + offsetMs), message };
  }

  // 2) วัน
  let dayOffset = null;
  [m, text] = take(text, /มะรืน(?:นี้)?/);
  if (m) dayOffset = 2;
  if (dayOffset === null) {
    [m, text] = take(text, /พรุ่งนี้/);
    if (m) dayOffset = 1;
  }
  if (dayOffset === null) {
    [m, text] = take(text, new RegExp(`วัน(${Object.keys(WEEKDAYS).join('|')})(?:\\s*(หน้า|นี้|ที่จะถึง))?`));
    if (m) dayOffset = ((WEEKDAYS[m[1]] - nowLocal.dow + 7) % 7) || 7;
  }
  if (dayOffset === null) {
    [m, text] = take(text, /(?:อาทิตย์|สัปดาห์)หน้า/);
    if (m) dayOffset = 7;
  }
  if (dayOffset === null) {
    [m, text] = take(text, /วันนี้|คืนนี้/);
    if (m) dayOffset = 0;
  }

  // 3) เวลา
  const time = extractTime(text);
  if (time) text = time.rest;

  if (dayOffset === null && !time) return null;

  const message = cleanMessage(text);
  if (!message) return { error: 'no_message' };

  const h = time ? time.h : 9;
  const min = time ? time.min : 0;
  if (h > 23 || min > 59) return { error: 'bad_time' };

  const base = new Date(Date.UTC(nowLocal.y, nowLocal.m, nowLocal.d) + (dayOffset ?? 0) * DAY_MS + (time?.nextDay ? DAY_MS : 0));
  let scheduledAt = toUtc(base.getUTCFullYear(), base.getUTCMonth(), base.getUTCDate(), h, min);

  // ระบุแต่เวลา (ไม่ระบุวัน) และเลยมาแล้ววันนี้ → พรุ่งนี้
  if (dayOffset === null && scheduledAt <= now) scheduledAt = new Date(scheduledAt.getTime() + DAY_MS);
  if (scheduledAt <= now) return { error: 'past' };

  return { scheduledAt, message };
}

function cleanMessage(text) {
  return text
    .replace(/(?:^|\s)(?:ช่วย)?(?:แจ้ง)?เตือน(?:ด้วย)?(?=\s|$|ให้|ว่า)/g, ' ')
    .replace(/^\s*(?:ให้|ว่า|ที|ตอน|เวลา|เมื่อ|ด้วย|น\.)\s*/g, '')
    .replace(/\s+(?:นะ|ด้วย|หน่อย|ครับ|ค่ะ|คะ|จ้า)\s*$/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

module.exports = { parseRelativeReminder };
