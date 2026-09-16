const { createTrip, getTrips, getExpensesByTrip, findTripByName, getUsers } = require('../../services/db');
const { calculateBalances } = require('../../utils/balance');
const { parseTripCreation, formatSplitMode } = require('../../utils/parser');
const { buildSettlementNotification } = require('./settlement');
const { settlementState } = require('../state');

async function handleCreateTrip(input) {
  const { name, defaultSplitMode, defaultNumPeople } = parseTripCreation(input);

  const existing = await findTripByName(name);
  if (existing) {
    return { type: 'trip_exists', reply: `มีทริป "${name}" อยู่แล้ว` };
  }

  const trip = await createTrip(name, defaultSplitMode, defaultNumPeople);
  const splitLabel = formatSplitMode(defaultSplitMode, defaultNumPeople);
  return {
    type: 'trip_created',
    trip,
    reply: `สร้างทริป "${name}" แล้ว (ค่าเริ่มต้น: ${splitLabel})\nบันทึกค่าใช้จ่ายด้วย #${name} ท้ายข้อความ\nเช่น ค่าโรงแรม 1200 #${name}`,
  };
}

async function handleListTrips() {
  const allTrips = await getTrips();
  if (!allTrips.length) {
    return { type: 'trips', reply: 'ยังไม่มีทริป สร้างทริปได้ด้วย: สร้างทริป (ชื่อ)' };
  }

  const lines = allTrips.map((t, i) => `${i + 1}. ${t.name}`);
  return { type: 'trips', reply: `ทริปทั้งหมด:\n${lines.join('\n')}` };
}

async function handleTripSummary(name) {
  const trip = await findTripByName(name);
  if (!trip) {
    return { type: 'error', reply: `ไม่พบทริป "${name}"` };
  }

  const tripExpenses = await getExpensesByTrip(trip.id);
  if (!tripExpenses.length) {
    return { type: 'trip_summary', reply: `ทริป "${trip.name}" ยังไม่มีค่าใช้จ่าย` };
  }

  const users = await getUsers();
  const total = tripExpenses.reduce((sum, e) => sum + Number(e.amount || 0), 0);
  const balances = calculateBalances(tripExpenses, users);
  const formatAmount = (v) => Math.abs(v).toFixed(2);

  const lines = [`สรุปทริป "${trip.name}"`, `รวม: ${total.toLocaleString()} บาท (${tripExpenses.length} รายการ)`];

  let notification = null;
  if (users.length === 2) {
    const [a, b] = users;
    const balA = Number(balances[String(a.id)] ?? 0);
    const balB = Number(balances[String(b.id)] ?? 0);
    if (balA !== 0 || balB !== 0) {
      if (balA >= 0 && balB <= 0) {
        lines.push(`${b.displayName} ต้องจ่ายคืน ${a.displayName} ${formatAmount(balB)} บาท`);
      } else if (balB >= 0 && balA <= 0) {
        lines.push(`${a.displayName} ต้องจ่ายคืน ${b.displayName} ${formatAmount(balA)} บาท`);
      }
      notification = buildSettlementNotification(balances, users);
    }
  }

  const itemLines = tripExpenses.map((e) => `• ${e.description} ${Number(e.amount).toLocaleString()} บาท`);
  lines.push('', ...itemLines);

  const prompt = notification ? '\n\nต้องการเรียกเก็บเงินเลยไหม? พิมพ์ ใช่ หรือ เรียกเก็บเงิน' : '';

  if (notification?.creditorLineUserId) {
    settlementState.pendingByUser[notification.creditorLineUserId] = notification;
  }

  return { type: 'trip_summary', reply: lines.join('\n') + prompt, notification };
}

module.exports = { handleCreateTrip, handleListTrips, handleTripSummary };
