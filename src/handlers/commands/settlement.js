const { getUsers, getExpenses, getTrips, clearSettlement, deleteExpenseById, savePaymentConfirmation, getPaymentConfirmation, completePaymentConfirmation, saveBillingRequest, resolveBillingRequestsForDebtor } = require('../../services/db');
const { calculateBalances } = require('../../utils/balance');
const { selectScopeExpenses } = require('../../utils/billing');
const { settlementState, deleteConfirmState, slipConfirmState } = require('../state');
const { handleSlipConfirm } = require('./slip');

// เก็บยอดและขอบเขต (scope) ที่ตกลงกันไว้ (creditor กด ใช่) เพื่อให้ debtor ใช้ตอนกด จ่ายแล้ว
// scope: { tripId } — tripId = null คือรอบทั่วไป (รายการทั่วไป + ทริปที่ปิดแล้ว), มีค่า = เฉพาะทริปนั้น
const DEFAULT_SCOPE = { tripId: null };
// ปุ่มตอบข้อเสนอเรียกเก็บเงินหลังสรุป (ส่งเป็นข้อความคำสั่งเดิม)
const BILLING_OFFER_REPLIES = [{ label: 'เรียกเก็บเงิน', text: 'ใช่' }, { label: 'ยังก่อน', text: 'ยกเลิก' }];
const agreedAmountByDebtor = {};

// สรุปใหม่ทุกครั้ง = ข้อเสนอเรียกเก็บเก่าที่ค้างอยู่ (ของทั้งสองคน) หมดอายุ
// ไม่งั้นคนที่เคยเป็นเจ้าหนี้จะกด "เรียกเก็บเงิน" แล้วได้ยอด/ทิศทางจากสรุปรอบเก่า
function resetBillingOffers() {
  for (const key of Object.keys(settlementState.pendingByUser)) delete settlementState.pendingByUser[key];
  for (const key of Object.keys(agreedAmountByDebtor)) delete agreedAmountByDebtor[key];
}

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

  if (users.length < 2) {
    return { type: 'error', reply: 'ระบบต้องมีผู้ใช้ 2 คนก่อน' };
  }

  const currentLineUserId = userContext.lineUserId || 'unknown';
  const agreed = agreedAmountByDebtor[currentLineUserId];
  const scope = agreed?.scope || DEFAULT_SCOPE;
  const [allExpenses, trips] = await Promise.all([getExpenses(), getTrips()]);
  const scoped = selectScopeExpenses(allExpenses, trips, scope);
  const summary = calculateBalances(scoped, users);
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

  const amount = agreed?.amount ?? Math.abs(currentBalance);
  delete agreedAmountByDebtor[currentLineUserId];

  const pending = {
    debtorName: currentUser.displayName,
    debtorLineUserId: currentUser.lineUserId,
    creditorName: creditor.displayName,
    creditorLineUserId: creditor.lineUserId,
    amount,
    // snapshot รายการที่นับในยอดนี้ — ตอนยืนยันรับเงินจะเคลียร์เฉพาะชุดนี้ ไม่แตะรายการที่เพิ่มเข้ามาทีหลัง
    scope: { ...scope, expenseIds: scope.expenseIds || scoped.filter((e) => !e.isCleared).map((e) => e.id) },
  };

  // เก็บใน DB — รอดการรีสตาร์ท และตัวรันแจ้งเตือนใช้เตือนเจ้าหนี้ทุกวัน 09:00 จนกว่าจะกด รับแล้ว (services/payment-reminders.js)
  if (creditor.lineUserId) {
    try {
      await savePaymentConfirmation(pending);
    } catch (error) {
      console.error('PAYMENT_CONFIRMATION_SAVE_FAILED', error.message);
      return { type: 'error', reply: 'บันทึกการแจ้งจ่ายเงินไม่สำเร็จ ยังไม่ได้แจ้ง' + ` ${creditor.displayName} กรุณาลองใหม่ (ถ้าเป็นซ้ำ ตรวจว่ารัน migration_011 ใน Supabase แล้ว)` };
    }
  }

  // ลูกหนี้แจ้งจ่ายแล้ว → หยุดเตือนค้างชำระ (จากตรงนี้เป็นหน้าที่ของเตือนยืนยันรับเงินแทน)
  try {
    await resolveBillingRequestsForDebtor(currentLineUserId);
  } catch (error) {
    console.error('BILLING_REQUEST_RESOLVE_FAILED', error.message);
  }

  return {
    type: 'payment_sent',
    notification: pending,
    reply: `แจ้ง ${creditor.displayName} แล้วว่าโอนเงิน ${amount.toFixed(2)} บาท — รอยืนยัน`,
  };
}

async function handlePaymentReceived(userContext) {
  const currentLineUserId = userContext.lineUserId || 'unknown';
  const missing = { type: 'payment_confirm_missing', reply: 'ยังไม่มีการแจ้งจ่ายเงินที่รอยืนยัน' };
  const pending = await getPaymentConfirmation(currentLineUserId);
  if (!pending) return missing;
  // ยืนยันแบบ atomic — กดซ้ำ/พร้อมกันจะเคลียร์ครั้งเดียว
  if (!(await completePaymentConfirmation(pending.id))) return missing;

  const [allExpenses, trips] = await Promise.all([getExpenses(), getTrips()]);
  const toClear = selectScopeExpenses(allExpenses, trips, pending.scope || DEFAULT_SCOPE)
    .filter((e) => !e.isCleared);
  await clearSettlement(toClear.map((e) => e.id));

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
    if (pendingDelete.items) {
      for (const item of pendingDelete.items) await deleteExpenseById(item.id);
      const total = pendingDelete.items.reduce((sum, t) => sum + Number(t.amount), 0);
      return {
        type: 'expense_deleted',
        reply: [
          `ยกเลิก ${pendingDelete.items.length} รายการแล้ว:`,
          ...pendingDelete.items.map((t) => `• ${t.description} ${Number(t.amount).toLocaleString()} บาท`),
          `รวม ${total.toLocaleString()} บาท`,
        ].join('\n'),
        quickReplies: [{ label: 'ลบต่อ', text: 'ลบรายการ' }],
      };
    }
    await deleteExpenseById(pendingDelete.id);
    return {
      type: 'expense_deleted',
      reply: `ยกเลิกรายการแล้ว: ${pendingDelete.description} ${Number(pendingDelete.amount).toLocaleString()} บาท`,
      quickReplies: [{ label: 'ลบต่อ', text: 'ลบรายการ' }],
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

  // ตรวจซ้ำก่อนส่ง: ยอด/ทิศทางตอนนี้ต้องตรงกับที่สรุปไว้ (เช่น มีการลบ/แก้รายการหลังสรุป)
  const [users, allExpenses, trips] = await Promise.all([getUsers(), getExpenses(), getTrips()]);
  const fresh = buildSettlementNotification(
    calculateBalances(selectScopeExpenses(allExpenses, trips, pending.scope || DEFAULT_SCOPE), users),
    users,
  );
  if (!fresh || fresh.debtorLineUserId !== pending.debtorLineUserId || Math.abs(fresh.amount - pending.amount) > 0.01) {
    const now = fresh
      ? `ตอนนี้ ${fresh.debtorName} ต้องจ่ายให้ ${fresh.creditorName} ${fresh.amount.toFixed(2)} บาท`
      : 'ตอนนี้ไม่มียอดค้างแล้ว';
    return {
      type: 'error',
      reply: `ยอดเปลี่ยนไปจากที่สรุปไว้ (${pending.debtorName} จ่าย ${pending.amount.toFixed(2)} บาท) — ${now}\nไม่ได้ส่งแจ้งเตือน กรุณาพิมพ์ สรุป ใหม่อีกครั้ง`,
    };
  }

  if (pending.debtorLineUserId) {
    agreedAmountByDebtor[pending.debtorLineUserId] = { amount: pending.amount, scope: pending.scope || DEFAULT_SCOPE };
    // เก็บลง DB ไว้เตือนค้างชำระ 3/7 วัน — ล้มเหลวไม่กระทบการเรียกเก็บ (เตือนเป็นส่วนเสริม)
    try {
      await saveBillingRequest({ ...pending, scope: pending.scope || DEFAULT_SCOPE });
    } catch (error) {
      console.error('BILLING_REQUEST_SAVE_FAILED', error.message, '(ตรวจว่ารัน migration_015 แล้ว)');
    }
  }

  return {
    type: 'settlement_trigger',
    notification: pending,
    reply: `ส่งแจ้งเตือนแล้วให้ ${pending.debtorName} จ่าย ${pending.amount.toFixed(2)} บาท ให้ ${pending.creditorName}`,
  };
}

module.exports = { BILLING_OFFER_REPLIES, resetBillingOffers, buildSettlementNotification, handlePaymentSent, handlePaymentReceived, handleConfirmYes };
