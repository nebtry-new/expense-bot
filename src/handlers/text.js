const { parseExpenseText } = require('../utils/parser');
const { calculateBalances } = require('../utils/balance');
const {
  addExpense,
  registerUser,
  getUsers,
  getExpenses,
  findUserByLineId,
  resetData,
  clearSettlement,
  terminateUserByName,
  restoreUserByName,
  renameUserByLineId,
  resetState,
} = require('../services/db');

const settlementState = {
  pendingByUser: {},
};

const paymentConfirmState = {
  pendingByUser: {},
};

function buildSettlementNotification(summary, users) {
  if (!Array.isArray(users) || users.length !== 2) {
    return null;
  }

  const userEntries = users.map((user) => ({
    id: String(user.id),
    lineUserId: user.lineUserId,
    displayName: user.displayName,
    balance: Number(summary[String(user.id)] ?? 0),
  }));

  const debtor = userEntries.find((entry) => entry.balance < 0);
  const creditor = userEntries.find((entry) => entry.balance > 0);

  if (!debtor || !creditor || Math.abs(debtor.balance) <= 0) {
    return null;
  }

  return {
    debtorName: debtor.displayName,
    creditorName: creditor.displayName,
    debtorLineUserId: debtor.lineUserId || null,
    creditorLineUserId: creditor.lineUserId || null,
    amount: Number(Math.abs(debtor.balance).toFixed(2)),
  };
}

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
        '',
        '── บันทึกค่าใช้จ่าย ──',
        'หารครึ่ง (default): ค่าอาหาร 350',
        'ส่วนตัว ไม่หาร: ค่าของขวัญ 200  หรือ  ค่าส่วนตัว 200',
        'ระบุจำนวนเอง: ค่าโรงแรม 1200 ฉัน 400 แฟน 800',
        'หารตามจำนวนคน: ค่าทัวร์ 3000 หาร 3 คน',
        '',
        '── คำสั่งอื่น ──',
        '1) สรุปยอด: สรุป',
        '2) จ่ายแล้ว: แจ้งให้ที่รักยืนยันการรับเงิน',
        '3) รับแล้ว: ยืนยันรับเงินและเคลียร์ยอด',
        '4) ลงทะเบียน: ลงทะเบียน (ชื่อ)',
        '5) เปลี่ยนชื่อ: เปลี่ยนชื่อ (ชื่อใหม่)',
        '6) reset: reset-all → reset-confirm',
        '',
        'หมายเหตุ: รองรับผู้ใช้ได้สูงสุด 2 คนเท่านั้น',
      ].join('\n'),
    };
  }

  if (/^reset-all$/i.test(normalized)) {
    resetState.pendingReset = true;
    return {
      type: 'reset_prompt',
      reply: 'reset-all จะล้างข้อมูลทั้งหมดของระบบ หากต้องการยืนยัน กรุณาพิมพ์ reset-confirm',
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
    settlementState.pendingByUser = {};
    paymentConfirmState.pendingByUser = {};
    return {
      type: 'reset_confirm',
      reply: 'ระบบถูกรีเซ็ตเรียบร้อยแล้ว กรุณาลงทะเบียนผู้ใช้ทั้ง 2 คนใหม่อีกครั้ง',
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
      reply: `${targetName} ถูกพักการใช้งานชั่วคราวไว้ก่อน`,
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
      reply: `${targetName} กลับมาใช้งานได้แล้ว`,
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

  const renameMatch = normalized.match(/^เปลี่ยนชื่อ\s*(.+)$/i);
  if (renameMatch) {
    const newDisplayName = renameMatch[1].trim();
    const lineUserId = userContext.lineUserId || 'unknown';
    const user = await renameUserByLineId(lineUserId, newDisplayName);

    if (!user) {
      return {
        type: 'error',
        reply: 'ไม่พบผู้ใช้ในระบบสำหรับเปลี่ยนชื่อ',
      };
    }

    return {
      type: 'rename_user',
      user,
      reply: `เปลี่ยนชื่อเรียบร้อยแล้ว: ${user.displayName}`,
    };
  }

  if (/^(รับแล้ว|ยืนยันรับเงิน|รับเงินแล้ว|ได้รับแล้ว|เงินเข้าแล้ว)$/i.test(normalized)) {
    const currentLineUserId = userContext.lineUserId || 'unknown';
    const pending = paymentConfirmState.pendingByUser[currentLineUserId];

    if (!pending) {
      return {
        type: 'payment_confirm_missing',
        reply: 'ยังไม่มีการแจ้งจ่ายเงินที่รอยืนยัน',
      };
    }

    delete paymentConfirmState.pendingByUser[currentLineUserId];
    await clearSettlement();

    return {
      type: 'payment_confirmed',
      reply: `ยืนยันแล้ว เคลียร์ยอด ${pending.amount.toFixed(2)} บาท เรียบร้อย`,
    };
  }

  if (/^(ใช่|yes|ok|เรียกเก็บเงิน)$/i.test(normalized)) {
    const currentLineUserId = userContext.lineUserId || 'unknown';
    const pending = settlementState.pendingByUser[currentLineUserId];

    if (!pending) {
      return {
        type: 'settlement_pending_missing',
        reply: 'ยังไม่มีคำสั่งเรียกเก็บเงินที่รอยืนยันในตอนนี้',
      };
    }

    delete settlementState.pendingByUser[currentLineUserId];

    return {
      type: 'settlement_trigger',
      notification: pending,
      reply: `ส่งแจ้งเตือนแล้วให้ ${pending.debtorName} จ่าย ${pending.amount.toFixed(2)} บาท ให้ ${pending.creditorName}`,
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

    if (users.length < 2) {
      return {
        type: 'summary',
        reply: 'ระบบต้องมีผู้ใช้อย่างน้อย 2 คนก่อนจึงจะคำนวณสรุปยอดได้',
      };
    }

    const summary = calculateBalances(expenses, users);
    const formatAmount = (value) => Math.abs(value).toFixed(2);

    if (users.length === 2) {
      const [userA, userB] = users;
      const summaryA = Number(summary[String(userA.id)] ?? 0);
      const summaryB = Number(summary[String(userB.id)] ?? 0);
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

      const prompt = notification
        ? '\n\nต้องการเรียกเก็บเงินเลยไหม? พิมพ์ ใช่ หรือ เรียกเก็บเงิน'
        : '';

      if (notification?.creditorLineUserId) {
        settlementState.pendingByUser[notification.creditorLineUserId] = notification;
      }

      return {
        type: 'summary',
        summary,
        reply: `${reply}${prompt}`,
        notification,
      };
    }

    const multiUserReply = users
      .map((user) => `${user.displayName} ${Number(summary[String(user.id)] ?? 0) >= 0 ? 'ได้รับ' : 'ต้องจ่าย'} ${formatAmount(Number(summary[String(user.id)] ?? 0))} บาท`)
      .join(', ');

    return {
      type: 'summary',
      summary,
      reply: `สรุปยอด: ${multiUserReply}`,
    };
  }

  if (/^จ่ายแล้ว|โอนแล้ว$/i.test(normalized)) {
    const users = await getUsers();
    const expenses = await getExpenses();

    if (users.length < 2) {
      return { type: 'error', reply: 'ระบบต้องมีผู้ใช้ 2 คนก่อน' };
    }

    const summary = calculateBalances(expenses, users);
    const currentLineUserId = userContext.lineUserId || 'unknown';
    const currentUser = users.find((u) => u.lineUserId === currentLineUserId);

    if (!currentUser) {
      return { type: 'error', reply: 'ไม่พบผู้ใช้ในระบบ กรุณาลงทะเบียนก่อน' };
    }

    const currentBalance = Number(summary[String(currentUser.id)] ?? 0);

    if (currentBalance >= 0) {
      return { type: 'noop', reply: 'คุณไม่มียอดค้างชำระในขณะนี้' };
    }

    const creditor = users.find((u) => String(u.id) !== String(currentUser.id));
    if (!creditor) {
      return { type: 'error', reply: 'ไม่พบผู้รับเงินในระบบ' };
    }

    const amount = Math.abs(currentBalance);
    const pending = {
      debtorName: currentUser.displayName,
      debtorLineUserId: currentUser.lineUserId,
      creditorName: creditor.displayName,
      creditorLineUserId: creditor.lineUserId,
      amount,
    };

    if (creditor.lineUserId) {
      paymentConfirmState.pendingByUser[creditor.lineUserId] = pending;
    }

    return {
      type: 'payment_sent',
      notification: pending,
      reply: `แจ้ง ${creditor.displayName} แล้วว่าโอนเงิน ${amount.toFixed(2)} บาท — รอยืนยัน`,
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

  const saved = await addExpense({
    paidByUserId: sender ? sender.id : lineUserId,
    paidByDisplayName: sender ? sender.displayName : lineUserId,
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
