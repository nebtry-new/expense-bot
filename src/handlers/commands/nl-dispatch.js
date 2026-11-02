// รับ intent ที่โมเดลตีความได้ (นอกจากบันทึกค่าใช้จ่าย) แล้วส่งต่อให้ handler เดิม
// - command: map เป็นข้อความคำสั่งเดิมแล้วรันผ่าน run(); คำสั่งที่กระทบเงิน/สถานะ ต้องให้ผู้ใช้ยืนยัน (ใช่/ยกเลิก) ก่อน
// - reminder: ตรวจเวลาด้วยโค้ดแล้วตั้งแจ้งเตือน
// - question: ตอบด้วย queries.js (คำนวณด้วยโค้ด ไม่ใช้ตัวเลขจากโมเดล)
const { getUsers, getExpenses, getTrips, scheduleNotification } = require('../../services/db');
const { answerQuestion } = require('../../services/queries');
const { parseDatetimePickerValue, toLocalDisplay } = require('../../utils/parse-date');
const { nlCommandState } = require('../state');

// confirm: true = กระทบเงิน/สถานะ ต้องถามก่อน
const COMMANDS = {
  summary: { text: () => 'สรุป' },
  monthly_summary: { text: () => 'สรุปยอดเดือนนี้' },
  list_trips: { text: () => 'ทริป' },
  trip_summary: { needs: 'tripName', text: (a) => `สรุปทริป ${a.tripName}` },
  create_trip: { needs: 'tripName', text: (a) => `สร้างทริป ${a.tripName}` },
  close_trip: { needs: 'tripName', confirm: true, label: (a) => `ปิดทริป "${a.tripName}" (ยอดทริปจะรวมใน สรุป)`, text: (a) => `ปิดทริป ${a.tripName}` },
  open_trip: { needs: 'tripName', confirm: true, label: (a) => `เปิดทริป "${a.tripName}" (ยอดทริปจะไม่รวมใน สรุป)`, text: (a) => `เปิดทริป ${a.tripName}` },
  list_deletable: { text: (a) => `ลบรายการ${a.keyword ? ` ${a.keyword}` : ''}` },
  delete_last: { text: () => 'ยกเลิกรายการล่าสุด' }, // มีขั้นตอนยืนยันของตัวเองอยู่แล้ว
  payment_sent: { confirm: true, label: () => 'แจ้งแฟนว่าคุณโอนเงินแล้ว', text: () => 'จ่ายแล้ว' },
  payment_received: { confirm: true, label: () => 'ยืนยันว่าได้รับเงินแล้ว และเคลียร์ยอดค้าง', text: () => 'รับแล้ว' },
  confirm_billing: { confirm: true, label: () => 'เรียกเก็บเงินจากแฟนตามยอดที่สรุปไว้', text: () => 'เรียกเก็บเงิน' },
  list_notifications: { text: () => 'ดูแจ้งเตือน' },
  cancel_notification: { needs: 'number', text: (a) => `ยกเลิกแจ้งเตือน ${a.number}` },
  help: { text: () => 'help' },
};

const NEEDS_REPLY = {
  tripName: 'ระบุชื่อทริปด้วย เช่น สรุปทริปหัวหิน',
  number: 'ระบุหมายเลขแจ้งเตือนด้วย (ดูหมายเลขได้จาก ดูแจ้งเตือน)',
};

async function dispatchOtherIntent(other, userContext, run, now = new Date()) {
  if (other.intent === 'command') return dispatchCommand(other, userContext, run);
  if (other.intent === 'reminder') return dispatchReminder(other, userContext, now);
  if (other.intent === 'question') return dispatchQuestion(other, userContext, now);
  return null;
}

async function dispatchCommand(other, userContext, run) {
  const def = COMMANDS[other.name];
  if (!def) return null;
  if (def.needs && !other[def.needs]) return { type: 'error', reply: NEEDS_REPLY[def.needs] };

  const canonical = def.text(other);
  if (!def.confirm) return run(canonical);

  const lineUserId = userContext.lineUserId || 'unknown';
  nlCommandState.pendingByUser[lineUserId] = { canonical, createdAt: Date.now() };
  return {
    type: 'nl_confirm',
    reply: `ตีความว่าต้องการ: ${def.label(other)}\nพิมพ์ ใช่ เพื่อยืนยัน หรือ ยกเลิก`,
  };
}

async function dispatchReminder(other, userContext, now) {
  const scheduledAt = parseDatetimePickerValue(other.whenLocal);
  if (Number.isNaN(scheduledAt.getTime())) return { type: 'error', reply: 'อ่านวันเวลาไม่ออก ลองพิมพ์ เช่น เตือนพรุ่งนี้บ่ายสาม ซื้อนม' };
  if (scheduledAt <= now) return { type: 'error', reply: 'วันเวลาที่ระบุผ่านไปแล้ว กรุณาระบุเวลาในอนาคต' };

  const lineUserId = userContext.lineUserId || 'unknown';
  await scheduleNotification({ message: other.message, scheduledAt, lineUserId: other.both ? null : lineUserId });
  return {
    type: 'notification_set',
    reply: `⏰ ตั้งแจ้งเตือน ${other.both ? '(ทั้งคู่)' : '(เฉพาะคุณ)'}: ${toLocalDisplay(scheduledAt)} น.\n"${other.message}"\n(ตีความจากข้อความ ดูได้ที่ ดูแจ้งเตือน)`,
  };
}

async function dispatchQuestion(other, userContext, now) {
  const lineUserId = userContext.lineUserId || 'unknown';
  const [users, expenses, trips] = await Promise.all([getUsers(), getExpenses(), getTrips()]);
  const sender = users.find((u) => u.lineUserId === lineUserId) || null;

  const answer = answerQuestion(
    { kind: other.kind, period: other.period, keywords: other.keywords, payer: other.payer, trip_name: other.tripName, limit: other.limit },
    { expenses, users, trips, sender, now },
  );
  if (answer.error) return null;
  return { type: 'nl_answer', reply: answer.reply };
}

module.exports = { dispatchOtherIntent, COMMANDS };
