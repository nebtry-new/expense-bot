const { parseExpenseText } = require('../utils/parser');
const { calculateBalances } = require('../utils/balance');
const {
  addExpense,
  registerUser,
  getUsers,
  getExpenses,
  findUserByLineId,
} = require('../services/db');

async function handleTextMessage(text, userContext = {}) {
  const normalized = String(text || '').trim();

  if (!normalized) {
    return { type: 'noop', reply: 'ไม่มีข้อความให้ประมวลผล' };
  }

  const registerMatch = normalized.match(/^ลงทะเบียน\s*(.+)$/i);
  if (registerMatch) {
    const displayName = registerMatch[1].trim();
    const user = await registerUser({
      lineUserId: userContext.lineUserId || `user_${Date.now()}`,
      displayName,
    });

    return {
      type: 'register',
      user,
      reply: `ลงทะเบียนสำเร็จ: ${user.displayName || displayName}`,
    };
  }

  if (/^สรุป$/i.test(normalized)) {
    const users = await getUsers();
    const expenses = await getExpenses();

    if (!users.length) {
      return {
        type: 'summary',
        reply: 'ยังไม่มีผู้ใช้ในระบบ กรุณาลงทะเบียนก่อน เช่น: ลงทะเบียน คุณA',
      };
    }

    const names = users.map((user) => user.displayName);
    const summary = calculateBalances(expenses, names.length >= 2 ? names : [names[0] || 'userA', 'userB']);

    const userA = names[0] || 'userA';
    const userB = names[1] || 'userB';

    const formatAmount = (value) => Math.abs(value).toFixed(2);

    let reply;
    if (summary[userA] >= 0 && summary[userB] <= 0) {
      reply = `สรุปยอด: ${userB} ต้องจ่ายให้ ${userA} ${formatAmount(summary[userB])} บาท`;
    } else if (summary[userB] >= 0 && summary[userA] <= 0) {
      reply = `สรุปยอด: ${userA} ต้องจ่ายให้ ${userB} ${formatAmount(summary[userA])} บาท`;
    } else {
      reply = `สรุปยอด: ${userA} ${summary[userA] >= 0 ? 'ได้รับ' : 'ต้องจ่าย'} ${formatAmount(summary[userA])} บาท, ${userB} ${summary[userB] >= 0 ? 'ได้รับ' : 'ต้องจ่าย'} ${formatAmount(summary[userB])} บาท`;
    }

    return {
      type: 'summary',
      summary,
      reply,
    };
  }

  const parsed = parseExpenseText(normalized);

  if (!parsed.amount) {
    return {
      type: 'noop',
      parsed,
      reply: 'ไม่พบจำนวนเงินที่บันทึกได้',
    };
  }

  const lineUserId = userContext.lineUserId || 'unknown';
  const sender = await findUserByLineId(lineUserId);
  const paidBy = sender ? sender.displayName : lineUserId;

  const saved = await addExpense({
    paidBy,
    description: parsed.description,
    amount: parsed.amount,
    splitMode: parsed.splitMode,
    numPeople: parsed.numPeople,
    customAmounts: parsed.customAmounts,
  });

  return {
    type: 'expense',
    parsed,
    saved,
    reply: `บันทึกค่าใช้จ่ายแล้ว: ${parsed.description} ${parsed.amount.toLocaleString()} บาท (${parsed.splitMode})`,
  };
}

module.exports = {
  handleTextMessage,
};
