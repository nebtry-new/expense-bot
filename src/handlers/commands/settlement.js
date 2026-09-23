const { getUsers, getExpenses, clearSettlement, deleteExpenseById } = require('../../services/db');
const { calculateBalances } = require('../../utils/balance');
const { settlementState, paymentConfirmState, deleteConfirmState, slipConfirmState } = require('../state');
const { handleSlipConfirm } = require('./slip');

// เก็บยอดที่ตกลงกันไว้ (creditor กด ใช่) เพื่อให้ debtor ใช้ตอนกด จ่ายแล้ว
const agreedAmountByDebtor = {};

function buildSettlementNotification(summary, users) {
  if (!Array.isArray(users) || users.length !== 2) return null;

  const userEntries = users.map((user) => ({
    id: String(user.id),
    lineUserId: user.lineUserId,
    displayName: user.displayName,
    balance: Number(summary[String(user.id)] ?? 0),
  }));

  const debtor = userEntries.find((entry) => entry.balance < 0);
  const creditor = userEntries.find((entry) => entry.balance > 0);

  if (!debtor || !creditor || Math.abs(debtor.balance) <= 0) return null;

  return {
    debtorName: debtor.displayName,
    creditorName: creditor.displayName,
    debtorLineUserId: debtor.lineUserId || null,
    creditorLineUserId: creditor.lineUserId || null,
    amount: Number(Math.abs(debtor.balance).toFixed(2)),
  };
}

async function handlePaymentSent(userContext) {
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

  const agreedAmount = agreedAmountByDebtor[currentLineUserId];
  const amount = agreedAmount ?? Math.abs(currentBalance);
  delete agreedAmountByDebtor[currentLineUserId];

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

async function handlePaymentReceived(userContext) {
  const currentLineUserId = userContext.lineUserId || 'unknown';
  const pending = paymentConfirmState.pendingByUser[currentLineUserId];

  if (!pending) {
    return { type: 'payment_confirm_missing', reply: 'ยังไม่มีการแจ้งจ่ายเงินที่รอยืนยัน' };
  }

  delete paymentConfirmState.pendingByUser[currentLineUserId];
  await clearSettlement();

  return {
    type: 'payment_confirmed',
    reply: `ยืนยันแล้ว เคลียร์ยอด ${pending.amount.toFixed(2)} บาท เรียบร้อย`,
  };
}

async function handleConfirmYes(userContext) {
  const currentLineUserId = userContext.lineUserId || 'unknown';

  const pendingDelete = deleteConfirmState.pendingByUser[currentLineUserId];
  if (pendingDelete) {
    delete deleteConfirmState.pendingByUser[currentLineUserId];
    await deleteExpenseById(pendingDelete.id);
    return {
      type: 'expense_deleted',
      reply: `ยกเลิกรายการแล้ว: ${pendingDelete.description} ${Number(pendingDelete.amount).toLocaleString()} บาท`,
    };
  }

  const slipResult = await handleSlipConfirm(userContext);
  if (slipResult) {
    // Clear any orphaned settlement state so creditor isn't stuck waiting
    delete settlementState.pendingByUser[currentLineUserId];
    return slipResult;
  }

  const pending = settlementState.pendingByUser[currentLineUserId];
  if (!pending) {
    const asDebtor = Object.values(settlementState.pendingByUser).find(
      (p) => p.debtorLineUserId === currentLineUserId
    );
    if (asDebtor) {
      return {
        type: 'noop',
        reply: `คุณเป็นฝ่ายต้องจ่าย ${asDebtor.amount.toFixed(2)} บาท ให้ ${asDebtor.creditorName}\nพิมพ์ จ่ายแล้ว เมื่อโอนเงินแล้ว`,
      };
    }
    return { type: 'noop', reply: 'ไม่มีรายการที่รอการยืนยัน' };
  }

  delete settlementState.pendingByUser[currentLineUserId];

  if (pending.debtorLineUserId) {
    agreedAmountByDebtor[pending.debtorLineUserId] = pending.amount;
  }

  return {
    type: 'settlement_trigger',
    notification: pending,
    reply: `ส่งแจ้งเตือนแล้วให้ ${pending.debtorName} จ่าย ${pending.amount.toFixed(2)} บาท ให้ ${pending.creditorName}`,
  };
}

module.exports = { buildSettlementNotification, handlePaymentSent, handlePaymentReceived, handleConfirmYes };
