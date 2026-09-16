const { parseExpenseText } = require('../../utils/parser');
const { addExpense, getUsers, findLastExpense } = require('../../services/db');
const { deleteConfirmState } = require('../state');

async function handleExpenseLines(inputLines, userContext) {
  const lineUserId = userContext.lineUserId || 'unknown';
  const allUsers = await getUsers();
  const sender = allUsers.find((u) => u.lineUserId === lineUserId) || null;
  const partner = allUsers.find((u) => u.lineUserId !== lineUserId) || null;

  const userNames = {
    senderName: sender?.displayName || null,
    partnerName: partner?.displayName || null,
  };

  const saveExpenseLine = async (line) => {
    const p = parseExpenseText(line, userNames);
    if (!p.amount) return null;

    if (p.splitMode === 'half' && p.splitWarning) {
      return {
        type: 'error',
        reply: `"${line}" — ชื่อในการแบ่งจ่าย "${p.splitWarning}" ไม่ตรงกับผู้ใช้ในระบบ ลองใช้ ฉัน/แฟน หรือชื่อที่ลงทะเบียนไว้แทน`,
      };
    }

    let customAmounts = null;
    if (p.splitMode === 'custom') {
      if (!partner) {
        return { type: 'error', reply: `"${line}" — ไม่สามารถระบุการแบ่งจ่ายได้ ยังไม่มีผู้ใช้คนที่ 2 ในระบบ` };
      }
      if (p.customAmounts) {
        const { me, partner: partnerAmt } = p.customAmounts;
        if (Math.abs(me + partnerAmt - p.amount) > 0.01) {
          return {
            type: 'error',
            reply: `"${line}" — ยอดที่ระบุ (${me} + ${partnerAmt} = ${me + partnerAmt}) ไม่ตรงกับยอดรวม ${p.amount} บาท`,
          };
        }
        customAmounts = {
          [String(sender.id)]: me,
          [String(partner.id)]: partnerAmt,
        };
      }
    }

    const saved = await addExpense({
      paidByUserId: sender ? sender.id : lineUserId,
      paidByDisplayName: sender ? sender.displayName : lineUserId,
      description: p.description,
      amount: p.amount,
      splitMode: p.splitMode,
      numPeople: p.numPeople,
      customAmounts,
    });

    return { parsed: p, saved };
  };

  if (inputLines.length > 1) {
    const rawResults = await Promise.all(inputLines.map(saveExpenseLine));
    const errors = rawResults.filter((r) => r?.type === 'error');
    if (errors.length) {
      return { type: 'error', reply: errors.map((e) => e.reply).join('\n') };
    }
    const results = rawResults.filter(Boolean);

    if (!results.length) {
      return { type: 'noop', reply: 'ไม่พบจำนวนเงินที่บันทึกได้' };
    }

    const total = results.reduce((sum, r) => sum + r.parsed.amount, 0);
    const itemLines = results.map((r) => `• ${r.parsed.description} ${r.parsed.amount.toLocaleString()} บาท (${r.parsed.splitMode})`);

    return {
      type: 'expense_batch',
      results,
      reply: [`บันทึก ${results.length} รายการแล้ว:`, ...itemLines, `รวม: ${total.toLocaleString()} บาท`].join('\n'),
    };
  }

  const result = await saveExpenseLine(inputLines[0]);
  if (!result) {
    return { type: 'noop', reply: 'ไม่พบจำนวนเงินที่บันทึกได้' };
  }
  if (result.type === 'error') {
    return result;
  }

  return {
    type: 'expense',
    parsed: result.parsed,
    saved: result.saved,
    reply: `บันทึกค่าใช้จ่ายแล้ว: ${result.parsed.description} ${result.parsed.amount.toLocaleString()} บาท (${result.parsed.splitMode})`,
  };
}

async function handleDeleteLastExpense(userContext) {
  const currentLineUserId = userContext.lineUserId || 'unknown';
  const allUsers = await getUsers();
  const currentUser = allUsers.find((u) => u.lineUserId === currentLineUserId);

  if (!currentUser) {
    return { type: 'error', reply: 'ไม่พบผู้ใช้ในระบบ กรุณาลงทะเบียนก่อน' };
  }

  const target = await findLastExpense(currentUser.id);

  if (!target) {
    return { type: 'noop', reply: 'ไม่พบรายการที่สามารถยกเลิกได้' };
  }

  deleteConfirmState.pendingByUser[currentLineUserId] = target;

  return {
    type: 'expense_delete_prompt',
    reply: `รายการ: ${target.description} ${Number(target.amount).toLocaleString()} บาท\nต้องการยกเลิกใช่หรือไม่? พิมพ์ ใช่ เพื่อยืนยัน`,
  };
}

module.exports = { handleExpenseLines, handleDeleteLastExpense };
