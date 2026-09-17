const { registerUser, getUsers, resetData, terminateUserByName, restoreUserByName, renameUserByLineId, resetState } = require('../services/db');
const { handleSummary, handleMonthlySummary } = require('./commands/summary');
const { handlePaymentSent, handlePaymentReceived, handleConfirmYes } = require('./commands/settlement');
const { handleExpenseLines, handleDeleteLastExpense } = require('./commands/expense');
const { handleSlipOverride } = require('./commands/slip');
const { handleCreateTrip, handleListTrips, handleTripSummary, handleAddPlace, handleListPlaces } = require('./commands/trip');
const { handleSetCarProfile, handleMapsLinkForEv, handleMapsDestinationForLocation, handleEvBatteryReply, extractMapsUrl } = require('./commands/ev');
const { evRouteState } = require('./state');
const { clearAllState, slipConfirmState } = require('./state');

const HELP_TEXT = [
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
  '2) สรุปค่าใช้จ่ายเดือนนี้: สรุปยอดเดือนนี้',
  '3) จ่ายแล้ว: แจ้งให้ที่รักยืนยันการรับเงิน',
  '4) รับแล้ว: ยืนยันรับเงินและเคลียร์ยอด',
  '5) ดูรายชื่อผู้ใช้: ผู้ใช้',
  '6) ลงทะเบียน: ลงทะเบียน (ชื่อ)',
  '7) เปลี่ยนชื่อ: เปลี่ยนชื่อ (ชื่อใหม่)',
  '8) ยกเลิกรายการล่าสุด: ยกเลิกรายการล่าสุด',
  '9) reset: reset-all → reset-confirm',
  '',
  '── ทริป ──',
  'สร้างทริป (หารครึ่ง): สร้างทริป (ชื่อ)',
  'สร้างทริป (หารตามจำนวนคน): สร้างทริป (ชื่อ) หาร 3',
  'บันทึกค่าใช้จ่ายใต้ทริป: ค่าโรงแรม 1200 #ชื่อทริป',
  'ดูรายการทริปทั้งหมด: ทริป',
  'สรุปค่าใช้จ่ายในทริป: สรุปทริป (ชื่อ)',
  'เพิ่มสถานที่ในทริป: เพิ่มที่ (ชื่อสถานที่) #ชื่อทริป',
  'ดูสถานที่ในทริป: ที่เที่ยว (ชื่อทริป)',
  '',
  '── EV ──',
  'ตั้งค่าระยะรถ: ตั้งค่ารถ 400 กม.',
  'หาจุดชาร์จ (แชร์ link): ส่ง Google Maps directions link แล้วบอกแบต %',
  'หาจุดชาร์จ (ตำแหน่งปัจจุบัน): กด แชร์ตำแหน่ง → ส่งตำแหน่งปลายทาง/Maps link/พิมพ์ชื่อ → บอกแบต %',
  '',
  'หมายเหตุ: รองรับผู้ใช้ได้สูงสุด 2 คนเท่านั้น',
].join('\n');

async function handleTextMessage(text, userContext = {}) {
  const normalized = String(text || '').trim();
  const lineUserId = userContext.lineUserId || 'unknown';

  if (!normalized) {
    return { type: 'noop', reply: 'ไม่มีข้อความให้ประมวลผล' };
  }

  if (/^(help|ช่วยเหลือ|manual|คู่มือ)$/i.test(normalized)) {
    return { type: 'help', reply: HELP_TEXT };
  }

  if (/^reset-all$/i.test(normalized)) {
    resetState.pendingReset = true;
    return { type: 'reset_prompt', reply: 'reset-all จะล้างข้อมูลทั้งหมดของระบบ หากต้องการยืนยัน กรุณาพิมพ์ reset-confirm' };
  }

  if (/^reset-confirm$/i.test(normalized)) {
    if (!resetState.pendingReset) {
      return { type: 'error', reply: 'ยังไม่มีคำสั่ง reset-all ที่ต้องยืนยันก่อน' };
    }
    await resetData();
    resetState.pendingReset = false;
    clearAllState();
    return { type: 'reset_confirm', reply: 'ระบบถูกรีเซ็ตเรียบร้อยแล้ว กรุณาลงทะเบียนผู้ใช้ทั้ง 2 คนใหม่อีกครั้ง' };
  }

  const terminateMatch = normalized.match(/^terminate\s+user\s+(.+)$/i);
  if (terminateMatch) {
    const user = await terminateUserByName(terminateMatch[1].trim());
    return user
      ? { type: 'terminate_user', reply: `${user.displayName} ถูกพักการใช้งานชั่วคราวไว้ก่อน` }
      : { type: 'error', reply: `ไม่พบผู้ใช้ ${terminateMatch[1].trim()} ในระบบ` };
  }

  const restoreMatch = normalized.match(/^restore\s+user\s+(.+)$/i);
  if (restoreMatch) {
    const user = await restoreUserByName(restoreMatch[1].trim());
    return user
      ? { type: 'restore_user', reply: `${user.displayName} กลับมาใช้งานได้แล้ว` }
      : { type: 'error', reply: `ไม่พบผู้ใช้ ${restoreMatch[1].trim()} ที่ถูกยกเลิก` };
  }

  if (/^(ผู้ใช้|users|รายชื่อผู้ใช้)$/i.test(normalized)) {
    const users = await getUsers();
    if (!users.length) return { type: 'users', reply: 'ยังไม่มีผู้ใช้ในระบบ กรุณาลงทะเบียนก่อน' };
    const lines = users.map((u, i) => `${i + 1}. ${u.displayName}`);
    return { type: 'users', reply: `ผู้ใช้ในระบบ (${users.length}/2):\n${lines.join('\n')}` };
  }

  const registerMatch = normalized.match(/^ลงทะเบียน\s*(.+)$/i);
  if (registerMatch) {
    const displayName = registerMatch[1].trim();
    try {
      const user = await registerUser({ lineUserId: userContext.lineUserId || `user_${Date.now()}`, displayName });
      return { type: 'register', user, reply: `ลงทะเบียนสำเร็จ: ${user.displayName || displayName}` };
    } catch (error) {
      console.error('REGISTER_USER_REJECTED', { lineUserId: userContext.lineUserId || 'unknown', displayName, error: error.message });
      return { type: 'error', reply: 'ระบบรองรับผู้ใช้ได้สูงสุด 2 คนเท่านั้น กรุณาใช้บัญชีที่มีอยู่แล้ว' };
    }
  }

  const renameMatch = normalized.match(/^เปลี่ยนชื่อ\s*(.+)$/i);
  if (renameMatch) {
    try {
      const user = await renameUserByLineId(userContext.lineUserId || 'unknown', renameMatch[1].trim());
      return user
        ? { type: 'rename_user', user, reply: `เปลี่ยนชื่อเรียบร้อยแล้ว: ${user.displayName}` }
        : { type: 'error', reply: 'ไม่พบผู้ใช้ในระบบสำหรับเปลี่ยนชื่อ' };
    } catch (error) {
      return { type: 'error', reply: error.message };
    }
  }

  if (/^(รับแล้ว|ยืนยันรับเงิน|รับเงินแล้ว|ได้รับแล้ว|เงินเข้าแล้ว)$/i.test(normalized)) {
    return handlePaymentReceived(userContext);
  }

  if (/^(ใช่|yes|ok|เรียกเก็บเงิน)$/i.test(normalized)) {
    return handleConfirmYes(userContext);
  }

  if (/^สรุป$/i.test(normalized)) {
    return handleSummary();
  }

  if (/^(จ่ายแล้ว|โอนแล้ว)$/i.test(normalized)) {
    return handlePaymentSent(userContext);
  }

  if (/^(ยกเลิกรายการล่าสุด|ยกเลิกรายการ|ยกเลิกล่าสุด|undo)$/i.test(normalized)) {
    return handleDeleteLastExpense(userContext);
  }

  if (/^(สรุปยอดเดือนนี้|สรุปเดือนนี้|ค่าใช้จ่ายเดือนนี้)$/i.test(normalized)) {
    return handleMonthlySummary();
  }

  const createTripMatch = normalized.match(/^สร้างทริป\s*(.+)$/i);
  if (createTripMatch) {
    return handleCreateTrip(createTripMatch[1].trim());
  }

  if (/^(ทริป|trips|รายการทริป)$/i.test(normalized)) {
    return handleListTrips();
  }

  const tripSummaryMatch = normalized.match(/^สรุปทริป\s*(.+)$/i);
  if (tripSummaryMatch) {
    return handleTripSummary(tripSummaryMatch[1].trim());
  }

  const addPlaceMatch = normalized.match(/^เพิ่มที่\s*(.+)$/i);
  if (addPlaceMatch) {
    return handleAddPlace(addPlaceMatch[1].trim());
  }

  const listPlacesMatch = normalized.match(/^ที่เที่ยว\s*(.+)$/i);
  if (listPlacesMatch) {
    return handleListPlaces(listPlacesMatch[1].trim());
  }

  const setCarMatch = normalized.match(/^ตั้งค่ารถ\s*(.+)$/i);
  if (setCarMatch) {
    return handleSetCarProfile(setCarMatch[1].trim());
  }

  // Google Maps directions link → store pending EV route, ask for battery %
  const mapsUrl = extractMapsUrl(normalized);
  if (mapsUrl) {
    // If already in location-pending flow, treat link as destination only
    if (evRouteState.pendingByUser[lineUserId]?.type === 'location') {
      const evResult = await handleMapsDestinationForLocation(mapsUrl, lineUserId);
      if (evResult) return evResult;
    } else {
      const evResult = await handleMapsLinkForEv(mapsUrl, lineUserId);
      if (evResult) return evResult;
    }
  }

  // Battery % reply for pending EV route (link or location flow)
  if (evRouteState.pendingByUser[lineUserId]) {
    const evResult = await handleEvBatteryReply(normalized, lineUserId);
    if (evResult) return evResult;
  }

  if (slipConfirmState.pendingByUser[lineUserId]) {
    const override = await handleSlipOverride(normalized, userContext);
    if (override) return override;
  }

  const inputLines = normalized.split('\n').map((l) => l.trim()).filter(Boolean);
  return handleExpenseLines(inputLines, userContext);
}

module.exports = { handleTextMessage };
