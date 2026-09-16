const { parseExpenseText } = require('../utils/parser');
const { calculateBalances } = require('../utils/balance');
const {
  addExpense,
  registerUser,
  getUsers,
  getExpenses,
  findUserByLineId,
  resetData,
  terminateUserByName,
  restoreUserByName,
  resetState,
} = require('../services/db');

async function handleTextMessage(text, userContext = {}) {
  const normalized = String(text || '').trim();

  if (!normalized) {
    return { type: 'noop', reply: 'ไม่มีข้อความให้ประมวลผล' };
  }

  if (/^(help|ช่วยเหลือ|manual|คู่มือ)$/i.test(normalized)) {
    return {
      type: 'help',
      reply: [
        'คู่มือการใช้งาน',
        '1) ลงทะเบียน: ลงทะเบียน คุณA',
        '2) บันทึกค่าใช้จ่าย: ค่าอาหาร 350 หรือ ค่าโรงแรม 1200',
        '3) สรุปยอด: สรุป',
        '4) แบบส่วนตัว: ค่าของขวัญ 200 หรือ ของขวัญ 200',
        '5) reset: reset-all → reset-confirm',
        '6) terminate user: terminate user คุณA',
        '7) restore user: restore user คุณA',
        'หมายเหตุ: ระบบรองรับผู้ใช้ได้สูงสุด 2 คนเท่านั้น',
      ].join('\n'),
    };
  }

  if (/^reset-all$/i.test(normalized)) {
    resetState.pendingReset = true;
    return {
      type: 'reset_prompt',
      reply: 'คำเตือน: reset-all จะล้างข้อมูลทั้งหมดของระบบ หากต้องการยืนยัน พิมพ์ reset-confirm',
    };
  }

  if (/^reset-confirm$/i.test(normalized)) {
    if (!resetState.pendingReset) {
      return {
        type: 'error',
        reply: 'ยังไม่มีคำสั่ง reset-all ที่ต้องยืนยันก่อน',
      };
    }

    await resetData();
    resetState.pendingReset = false;
    return {
      type: 'reset_confirm',
      reply: 'ระบบถูกรีเซ็ตเรียบร้อยแล้ว กรุณาลงทะเบียนผู้ใช้ทั้ง 2 คนใหม่',
    };
  }

  const terminateMatch = normalized.match(/^terminate\s+user\s+(.+)$/i);
  if (terminateMatch) {
    const targetName = terminateMatch[1].trim();
    const user = await terminateUserByName(targetName);

    if (!user) {
      return {
        type: 'error',
        reply: `ไม่พบผู้ใช้ ${targetName} ในระบบ`,
      };
    }

    return {
      type: 'terminate_user',
      reply: `ผู้ใช้ ${targetName} ถูกยกเลิกการใช้งานแล้ว`,
    };
  }

  const restoreMatch = normalized.match(/^restore\s+user\s+(.+)$/i);
  if (restoreMatch) {
    const targetName = restoreMatch[1].trim();
    const user = await restoreUserByName(targetName);

    if (!user) {
      return {
        type: 'error',
        reply: `ไม่พบผู้ใช้ ${targetName} ที่ถูกยกเลิก`,
      };
    }

    return {
      type: 'restore_user',
      reply: `ผู้ใช้ ${targetName} ถูกกู้คืนกลับมาใช้งานได้แล้ว`,
    };
  }

  const registerMatch = normalized.match(/^ลงทะเบียน\s*(.+)$/i);
  if (registerMatch) {
    const displayName = registerMatch[1].trim();

    try {
      const user = await registerUser({
        lineUserId: userContext.lineUserId || `user_${Date.now()}`,
        displayName,
      });

      return {
        type: 'register',
        user,
        reply: `ลงทะเบียนสำเร็จ: ${user.displayName || displayName}`,
      };
    } catch (error) {
      console.error('REGISTER_USER_REJECTED', {
        lineUserId: userContext.lineUserId || 'unknown',
        displayName,
        error: error.message,
      });

      return {
        type: 'error',
        reply: 'ระบบรองรับผู้ใช้ได้สูงสุด 2 คนเท่านั้น กรุณาใช้บัญชีที่มีอยู่แล้ว',
      };
    }
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

    if (users.length < 2) {
      return {
        type: 'summary',
        reply: 'ระบบต้องมีผู้ใช้อย่างน้อย 2 คนก่อนจึงจะคำนวณสรุปยอดได้',
      };
    }

    const names = users.map((user) => user.displayName);
    const summary = calculateBalances(expenses, names.length >= 2 ? names : [names[0] || 'userA', 'userB']);
    const formatAmount = (value) => Math.abs(value).toFixed(2);

    if (names.length === 2) {
      const [userA, userB] = names;
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

    const multiUserReply = names
      .map((name) => `${name} ${summary[name] >= 0 ? 'ได้รับ' : 'ต้องจ่าย'} ${formatAmount(summary[name])} บาท`)
      .join(', ');

    return {
      type: 'summary',
      summary,
      reply: `สรุปยอด: ${multiUserReply}`,
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
