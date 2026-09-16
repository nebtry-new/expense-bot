const { addExpense, getUsers } = require('../../services/db');
const { parseCustomSplit, formatSplitMode } = require('../../utils/parser');
const { slipConfirmState } = require('../state');

async function handleSlipConfirm(userContext) {
  const lineUserId = userContext.lineUserId || 'unknown';
  const pending = slipConfirmState.pendingByUser[lineUserId];

  if (!pending) return null;

  delete slipConfirmState.pendingByUser[lineUserId];

  const saved = await addExpense({
    paidByUserId: pending.paidByUserId,
    paidByDisplayName: pending.paidByDisplayName,
    description: pending.description,
    amount: pending.amount,
    splitMode: 'half',
    numPeople: null,
    customAmounts: null,
  });

  return {
    type: 'expense',
    saved,
    reply: `บันทึกแล้ว: ${pending.description} ${Number(pending.amount).toLocaleString()} บาท (${formatSplitMode('half')})`,
  };
}

async function handleSlipOverride(text, userContext) {
  const lineUserId = userContext.lineUserId || 'unknown';
  const pending = slipConfirmState.pendingByUser[lineUserId];
  if (!pending) return null;

  if (/^(ยกเลิก|cancel|ไม่เอา)$/i.test(text)) {
    delete slipConfirmState.pendingByUser[lineUserId];
    return { type: 'noop', reply: 'ยกเลิก slip แล้ว' };
  }

  let splitMode = null;
  let numPeople = null;
  let customAmounts = null;

  if (/(ส่วนตัว|ของขวัญ|ไม่หาร|private|personal)/i.test(text)) {
    splitMode = 'none';
  } else {
    const perHeadMatch = text.match(/(?:^|\s)(?:หาร|split)\s*(\d+)(?:\s*คน)?/i)
      ?? text.match(/\d+\s*\/\s*(\d+)/);
    if (perHeadMatch) {
      numPeople = Number.parseInt(perHeadMatch[1], 10);
      splitMode = numPeople === 2 ? 'half' : 'per_head';
      if (splitMode === 'half') numPeople = null;
    }
  }

  if (!splitMode) {
    const allUsers = await getUsers();
    const sender = allUsers.find((u) => u.lineUserId === lineUserId);
    const partner = allUsers.find((u) => u.lineUserId !== lineUserId);
    const userNames = {
      senderName: sender?.displayName || null,
      partnerName: partner?.displayName || null,
    };

    const parsed = parseCustomSplit(text, userNames, pending.amount);
    if (parsed) {
      if (sender && partner) {
        splitMode = 'custom';
        customAmounts = {
          [String(sender.id)]: parsed.me,
          [String(partner.id)]: parsed.partner,
        };
      } else {
        return {
          type: 'error',
          reply: 'ไม่สามารถระบุการแบ่งจ่ายได้ ยังไม่ครบ 2 ผู้ใช้ในระบบ',
        };
      }
    }
  }

  if (!splitMode) {
    return {
      type: 'error',
      reply: `ไม่เข้าใจรูปแบบที่พิมพ์ กรุณาเลือก:\n• ใช่ — หารครึ่ง\n• ไม่หาร — ส่วนตัว\n• หาร 3 — หารตามจำนวนคน\n• ฉัน X แฟน Y — ระบุเอง\n• ยกเลิก — ไม่บันทึก`,
    };
  }

  delete slipConfirmState.pendingByUser[lineUserId];

  const saved = await addExpense({
    paidByUserId: pending.paidByUserId,
    paidByDisplayName: pending.paidByDisplayName,
    description: pending.description,
    amount: pending.amount,
    splitMode,
    numPeople,
    customAmounts,
  });

  return {
    type: 'expense',
    saved,
    reply: `บันทึกแล้ว: ${pending.description} ${Number(pending.amount).toLocaleString()} บาท (${formatSplitMode(splitMode, numPeople)})`,
  };
}

module.exports = { handleSlipConfirm, handleSlipOverride };
