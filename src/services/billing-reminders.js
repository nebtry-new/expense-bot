// เตือนลูกหนี้ที่ถูกเรียกเก็บแล้วแต่ยังไม่กด "จ่ายแล้ว": ครั้งที่ 1 = 09:00 (เวลาไทย) ของวันที่ 3 หลังเรียกเก็บ, ครั้งที่ 2 = วันที่ 7
// ก่อนเตือนทุกครั้งตรวจซ้ำว่ายังมียอดค้างจริง (เช่น เจ้าหนี้ลบรายการ/เคลียร์ไปแล้ว → ปิดเรื่องเงียบๆ ไม่เตือนผิด)
const { listOpenBillingRequests, markBillingReminded, resolveBillingRequest, getUsers, getExpenses, getTrips } = require('./db');
const { calculateBalances } = require('../utils/balance');
const { selectScopeExpenses } = require('../utils/billing');
const { buildQuickReplyMessage } = require('../utils/quick-reply');
const { atReminderHourAfterDays, thaiDateTime } = require('../utils/reminder-time');

const STAGES = [7, 3]; // ตรวจ 7 ก่อน — ถ้าเลยทั้งสองวัน (เซิร์ฟเวอร์ดับ) ส่งครั้งเดียวด้วยข้อความของ 7 วัน

function dueStage(req, now) {
  const base = new Date(req.requestedAt).getTime();
  if (!req.reminded7At && now >= atReminderHourAfterDays(base, 7)) return 7;
  if (!req.reminded3At && !req.reminded7At && now >= atReminderHourAfterDays(base, 3)) return 3;
  return null;
}

// ยอดที่ลูกหนี้ยังค้างตามขอบเขตที่เรียกเก็บ (0 = ไม่มีแล้ว)
async function currentDebt(req, users, allExpenses, trips) {
  const debtor = users.find((u) => u.lineUserId === req.debtorLineUserId);
  if (!debtor) return 0;
  const scoped = selectScopeExpenses(allExpenses, trips, req.scope || { tripId: null })
    .filter((e) => !e.isCleared);
  const balance = Number(calculateBalances(scoped, users)[String(debtor.id)] ?? 0);
  return balance < 0 ? Math.abs(balance) : 0;
}

// sendPushFn(lineUserId, message) ต้องคืน true เมื่อส่งสำเร็จ — ส่งไม่สำเร็จไม่ mark ว่าเตือนแล้ว (รอบหน้าลองใหม่)
async function runBillingReminders(sendPushFn, now = Date.now()) {
  let sent = 0;
  let open;
  try {
    open = await listOpenBillingRequests();
  } catch (error) {
    console.error('BILLING_REMINDERS_FAILED', error.message, '(ตรวจว่ารัน migration_015 แล้ว)');
    return { sent: 0 };
  }

  const due = open.map((r) => ({ r, stage: dueStage(r, now) })).filter((x) => x.stage);
  if (!due.length) return { sent: 0 };

  const [users, allExpenses, trips] = await Promise.all([getUsers(), getExpenses(), getTrips()]);
  for (const { r, stage } of due) {
    try {
      const debt = await currentDebt(r, users, allExpenses, trips);
      if (!debt) {
        await resolveBillingRequest(r.id);
        continue;
      }
      const when = thaiDateTime(new Date(r.requestedAt).getTime());
      const text = stage === 7
        ? [`🔔 ครบ 7 วันแล้วที่ ${r.creditorName} เรียกเก็บเงิน`, `ยังค้างจ่าย ${debt.toFixed(2)} บาท (เรียกเก็บเมื่อ ${when})`, 'โอนแล้วแตะ "จ่ายแล้ว" เพื่อแจ้ง']
        : [`⏰ ยังไม่ได้จ่ายให้ ${r.creditorName}`, `ค้างจ่าย ${debt.toFixed(2)} บาท (เรียกเก็บเมื่อ ${when})`, 'โอนแล้วแตะ "จ่ายแล้ว" เพื่อแจ้ง'];
      if (await sendPushFn(r.debtorLineUserId, buildQuickReplyMessage(text.join('\n'), [{ label: '✅ จ่ายแล้ว', text: 'จ่ายแล้ว' }]))) {
        await markBillingReminded(r.id, stage, new Date(now));
        sent += 1;
      }
    } catch (error) {
      console.error('BILLING_REMINDER_FAILED', error?.message || error);
    }
  }
  return { sent };
}

module.exports = { runBillingReminders, dueStage, STAGES };
