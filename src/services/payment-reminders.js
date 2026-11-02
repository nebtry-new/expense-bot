// เตือนเจ้าหนี้ซ้ำ ถ้าลูกหนี้แจ้ง "จ่ายแล้ว" แต่ยังไม่มีใครกด "รับแล้ว"
// เวลา: 09:00 (เวลาไทย) ของวันถัดจากวันที่แจ้ง แล้วซ้ำทุกวัน 09:00 จนกว่าจะยืนยัน
// สถานะอยู่ในตาราง payment_confirmations (migration_011) จึงรอดการรีสตาร์ท
const { listPendingPaymentConfirmations, markPaymentReminded } = require('./db');
const { buildQuickReplyMessage } = require('../utils/quick-reply');

const { atReminderHourAfterDays, thaiDateTime } = require('../utils/reminder-time');

// เวลา (ms) ที่ควรเตือนครั้งถัดไป = HH:00 เวลาไทยของ "วันถัดจาก" วันของ baseMs
const nextReminderAt = (baseMs) => atReminderHourAfterDays(baseMs, 1);

// sendPushFn(lineUserId, textOrMessage) ต้องคืน true เมื่อส่งสำเร็จ — ส่งไม่สำเร็จจะไม่นับว่าเตือนแล้ว (รอบหน้าลองใหม่)
async function runPaymentReminders(sendPushFn, now = Date.now()) {
  let sent = 0;
  let pendings;
  try {
    pendings = await listPendingPaymentConfirmations();
  } catch (error) {
    console.error('PAYMENT_REMINDERS_FAILED', error.message, '(ตรวจว่ารัน migration_011 แล้ว)');
    return { sent: 0 };
  }

  for (const pending of pendings) {
    if (!pending.creditorLineUserId) continue;
    const base = new Date(pending.lastRemindedAt || pending.requestedAt).getTime();
    if (now < nextReminderAt(base)) continue;

    const text = [
      '⏰ ยังไม่ได้ยืนยันรับเงิน',
      `${pending.debtorName} แจ้งว่าโอน ${pending.amount.toFixed(2)} บาท ให้คุณเมื่อ ${thaiDateTime(new Date(pending.requestedAt).getTime())}`,
      'ตรวจยอดเข้าแล้วแตะ "รับแล้ว" เพื่อเคลียร์ยอด',
    ].join('\n');
    try {
      if (await sendPushFn(pending.creditorLineUserId, buildQuickReplyMessage(text, [{ label: '✅ รับแล้ว', text: 'รับแล้ว' }]))) {
        await markPaymentReminded(pending.id, new Date(now));
        sent += 1;
      }
    } catch (error) {
      console.error('PAYMENT_REMINDER_FAILED', error?.message || error);
    }
  }
  return { sent };
}

module.exports = { runPaymentReminders, nextReminderAt };
