const { getUsers, getExpenses } = require('../../services/db');
const { calculateBalances } = require('../../utils/balance');
const { buildSettlementNotification } = require('./settlement');
const { settlementState } = require('../state');

async function handleSummary() {
  const users = await getUsers();
  const expenses = await getExpenses();

  if (!users.length) {
    return { type: 'summary', reply: 'ยังไม่มีผู้ใช้ในระบบ กรุณาลงทะเบียนก่อน เช่น ลงทะเบียน ปิ๊ก' };
  }

  if (users.length < 2) {
    return { type: 'summary', reply: 'ระบบต้องมีผู้ใช้อย่างน้อย 2 คนก่อนจึงจะคำนวณสรุปยอดได้' };
  }

  const summary = calculateBalances(expenses, users);
  const formatAmount = (value) => Math.abs(value).toFixed(2);

  if (users.length === 2) {
    const [userA, userB] = users;
    const summaryA = Number(summary[String(userA.id)] ?? 0);
    const summaryB = Number(summary[String(userB.id)] ?? 0);

    if (summaryA === 0 && summaryB === 0) {
      return { type: 'summary', summary, reply: 'ไม่มียอดค้างจ่าย' };
    }

    let reply;
    let notification = null;

    if (summaryA >= 0 && summaryB <= 0) {
      reply = `สรุปยอด: ${userB.displayName} ต้องจ่ายให้ ${userA.displayName} ${formatAmount(summaryB)} บาท`;
      notification = buildSettlementNotification(summary, users);
    } else if (summaryB >= 0 && summaryA <= 0) {
      reply = `สรุปยอด: ${userA.displayName} ต้องจ่ายให้ ${userB.displayName} ${formatAmount(summaryA)} บาท`;
      notification = buildSettlementNotification(summary, users);
    } else {
      reply = `สรุปยอด: ${userA.displayName} ${summaryA >= 0 ? 'ได้รับ' : 'ต้องจ่าย'} ${formatAmount(summaryA)} บาท, ${userB.displayName} ${summaryB >= 0 ? 'ได้รับ' : 'ต้องจ่าย'} ${formatAmount(summaryB)} บาท`;
    }

    const prompt = notification ? '\n\nต้องการเรียกเก็บเงินเลยไหม? พิมพ์ ใช่ หรือ เรียกเก็บเงิน' : '';

    if (notification?.creditorLineUserId) {
      settlementState.pendingByUser[notification.creditorLineUserId] = notification;
    }

    return { type: 'summary', summary, reply: `${reply}${prompt}`, notification };
  }

  const multiUserReply = users
    .map((user) => `${user.displayName} ${Number(summary[String(user.id)] ?? 0) >= 0 ? 'ได้รับ' : 'ต้องจ่าย'} ${formatAmount(Number(summary[String(user.id)] ?? 0))} บาท`)
    .join(', ');

  return { type: 'summary', summary, reply: `สรุปยอด: ${multiUserReply}` };
}

async function handleMonthlySummary() {
  const users = await getUsers();
  const allExpenses = await getExpenses();

  const now = new Date();
  const year = now.getFullYear();
  const month = now.getMonth();

  const thaiMonths = ['มกราคม', 'กุมภาพันธ์', 'มีนาคม', 'เมษายน', 'พฤษภาคม', 'มิถุนายน', 'กรกฎาคม', 'สิงหาคม', 'กันยายน', 'ตุลาคม', 'พฤศจิกายน', 'ธันวาคม'];
  const monthName = thaiMonths[month];

  const thisMonthExpenses = allExpenses.filter((expense) => {
    if (!expense.createdAt) return false;
    const d = new Date(expense.createdAt);
    return d.getFullYear() === year && d.getMonth() === month;
  });

  if (!thisMonthExpenses.length) {
    return { type: 'summary_monthly', reply: `ยังไม่มีค่าใช้จ่ายในเดือน${monthName} ${year}` };
  }

  const total = thisMonthExpenses.reduce((sum, e) => sum + Number(e.amount || 0), 0);
  const monthlySummary = calculateBalances(thisMonthExpenses, users);

  const lines = [
    `สรุปค่าใช้จ่ายเดือน${monthName} ${year}`,
    `รวมทั้งหมด: ${total.toLocaleString()} บาท (${thisMonthExpenses.length} รายการ)`,
  ];

  const oweLines = users.map((user) => {
    const balance = Number(monthlySummary[String(user.id)] ?? 0);
    return { displayName: user.displayName, owes: Math.max(0, -balance) };
  });

  if (oweLines.some((u) => u.owes > 0)) {
    for (const u of oweLines) {
      lines.push(`${u.displayName} ค้างจ่าย: ${u.owes.toLocaleString()} บาท`);
    }
  }

  return { type: 'summary_monthly', reply: lines.join('\n') };
}

module.exports = { handleSummary, handleMonthlySummary };
