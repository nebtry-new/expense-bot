const { addExpense, getUsers } = require('../../services/db');
const { parseCustomSplit } = require('../../utils/parser');
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
    reply: `บันทึกแล้ว: ${pending.description} ${Number(pending.amount).toLocaleString()} บาท (หารครึ่ง)`,
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
    if (sender && partner) {
      const userNames = { senderName: sender.displayName, partnerName: partner.displayName };
      const parsed = parseCustomSplit(text, userNames, pending.amount);
      if (parsed) {
        splitMode = 'custom';
        customAmounts = {
          [String(sender.id)]: parsed.me,
          [String(partner.id)]: parsed.partner,
        };
      }
    }
  }

  if (!splitMode) return null;

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
    reply: `บันทึกแล้ว: ${pending.description} ${Number(pending.amount).toLocaleString()} บาท (${splitMode})`,
  };
}

module.exports = { handleSlipConfirm, handleSlipOverride };
