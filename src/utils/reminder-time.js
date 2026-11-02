// เวลาเตือนแบบ "HH:00 เวลาไทย ของวันที่ N หลังวันที่ baseMs" (ใช้กับเตือนยืนยันรับเงิน และเตือนค้างชำระ)
const TZ_OFFSET_MS = 7 * 60 * 60 * 1000; // เวลาไทย (ไม่มี DST)
const DAY_MS = 24 * 60 * 60 * 1000;

const reminderHour = () => {
  const h = Number(process.env.PAYMENT_REMINDER_HOUR);
  return Number.isInteger(h) && h >= 0 && h <= 23 ? h : 9;
};

function atReminderHourAfterDays(baseMs, days) {
  const localDayStart = Math.floor((baseMs + TZ_OFFSET_MS) / DAY_MS) * DAY_MS;
  return localDayStart + days * DAY_MS + reminderHour() * 60 * 60 * 1000 - TZ_OFFSET_MS;
}

const thaiDateTime = (ms) => {
  const d = new Date(ms + TZ_OFFSET_MS);
  return `${d.getUTCDate()}/${d.getUTCMonth() + 1} ${String(d.getUTCHours()).padStart(2, '0')}:${String(d.getUTCMinutes()).padStart(2, '0')} น.`;
};

module.exports = { TZ_OFFSET_MS, DAY_MS, reminderHour, atReminderHourAfterDays, thaiDateTime };
