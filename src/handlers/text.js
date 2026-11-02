const { registerUser, getUsers, resetData, terminateUserByName, restoreUserByName, renameUserByLineId, resetState } = require('../services/db');
const { handleSummary, handleMonthlySummary } = require('./commands/summary');
const { handlePaymentSent, handlePaymentReceived, handleConfirmYes } = require('./commands/settlement');
const { handleListUnrecognized, handleNaturalLanguageExpense, handleExpenseLines, handleDeleteLastExpense, handleListDeletableExpenses, handlePickDeleteExpense } = require('./commands/expense');
const { handleSlipOverride } = require('./commands/slip');
const { handleCreateTrip, handleListTrips, handleTripSummary, handleSetTripBillable, handleAddPlace, handleDeletePlace, handleMarkVisited, handleListPlaces, handleTripRoute, handleAddNote, handleListNotes } = require('./commands/trip');
const { handleShowDatetimePicker, handleScheduleFromDatetime, handleScheduleNotification, handleListNotifications, handleCancelNotification } = require('./commands/notifications');
const { handleSetCarProfile, handleMapsLinkForEv, handleMapsDestinationForLocation, handleEvBatteryReply, extractMapsUrl } = require('./commands/ev');
const { evRouteState } = require('./state');
const { normalizeThaiNumbers } = require('../utils/thai-numbers');
const { extractDatePhrase } = require('../utils/date-phrases');
const { dispatchOtherIntent } = require('./commands/nl-dispatch');
const { clearAllState, slipConfirmState, datetimePickerState, deleteConfirmState, deleteListState, nlCommandState } = require('./state');

const HELP_TEXT = [
  '📖 คู่มือการใช้งาน',
  '',
  '━━ 💸 บันทึกค่าใช้จ่าย ━━',
  '• หารครึ่ง (default): ค่าอาหาร 350',
  '• ส่วนตัว ไม่เอามาคิดเงิน: ค่ากาแฟ 80 ส่วนตัว',
  '• ระบุจำนวนเอง: ค่าโรงแรม 1200 ฉัน 400 แฟน 800',
  '• หารตามจำนวนคน: ค่าทัวร์ 3000 หาร 3 คน',
  '• หลายรายการ: พิมพ์ขึ้นบรรทัดใหม่ทีละรายการ',
  '• พิมพ์เป็นประโยคธรรมดาก็ได้: เลี้ยงข้าวแฟน 450 / ปิ๊กยืมแจม 500 / คืนแจม 500',
  '• ถามได้เลย: เดือนนี้ใช้ไปเท่าไหร่ / กินกาแฟไปเท่าไหร่ / ตอนนี้ใครต้องจ่ายใคร / รายการล่าสุด',
  '• สั่งงานด้วยประโยคได้: ได้เงินจากแจมแล้ว / ทริปหัวหินจบแล้วเก็บเงินได้เลย (เรื่องเงินจะถามยืนยันก่อน)',
  '• ใส่วันย้อนหลังได้: เมื่อวานกินข้าว 100 / 3 วันก่อน ค่าน้ำมัน 500',
  '• หลายรายการในประโยคเดียว: ข้าว 100 กาแฟ 50',,
  '• ส่งรูป slip: บอทอ่านยอดให้ แล้วตอบ ใช่ / ไม่หาร / หาร 3 / ยกเลิก',
  '',
  '━━ 📊 สรุปยอด & เคลียร์เงิน ━━',
  '• สรุปยอดค้างทั้งหมด: สรุป',
  '• สรุปเดือนนี้: สรุปยอดเดือนนี้',
  '• โอนเงินแล้ว: จ่ายแล้ว',
  '• ยืนยันรับเงิน + เคลียร์ยอด: รับแล้ว',
  '',
  '━━ 🗑 ลบ / ยกเลิกรายการ ━━',
  '• ยกเลิกรายการล่าสุด: ยกเลิกรายการล่าสุด → ใช่',
  '• เลือกลบรายการเอง: ลบรายการ [คำค้น/#ทริป] → ลบ [เลข] → ใช่ (รวมรายการของแฟน)',
  '',
  '━━ ✈️ ทริป ━━',
  '• สร้างทริป: สร้างทริป (ชื่อ)  หรือ  สร้างทริป (ชื่อ) หาร 3',
  '• บันทึกค่าใช้จ่ายในทริป: ค่าโรงแรม 1200 #ชื่อทริป',
  '• ดูทริปทั้งหมด: ทริป',
  '• สรุปค่าใช้จ่ายทริป (เรียกเก็บเฉพาะทริป): สรุปทริป (ชื่อ)',
  '• ทริปใหม่ยังไม่รวมใน สรุป → พร้อมเรียกเก็บ: ปิดทริป (ชื่อ)',
  '• ดึงทริปออกจาก สรุป อีกครั้ง: เปิดทริป (ชื่อ)',
  '',
  '━━ 📍 สถานที่ในทริป ━━',
  '• เพิ่มสถานที่: เพิ่มที่ (ชื่อ) [กิน/เที่ยว/ที่พัก/ช้อป] [url] #ทริป',
  '• เพิ่มพร้อม note: เพิ่มที่ (ชื่อ) | (note) กิน #ทริป',
  '• ลบสถานที่: ลบที่ (ชื่อสถานที่) #ทริป',
  '• บันทึกว่าไปแล้ว: ไปแล้ว (ชื่อสถานที่) #ทริป',
  '• ดูสถานที่: ที่เที่ยว (ชื่อทริป)',
  '• ดูเส้นทางทุกจุด: เส้นทางทริป (ชื่อทริป)',
  '',
  '━━ 📝 โน้ตทริป ━━',
  '• เพิ่ม note: โน้ตทริป (ข้อความ) #ทริป',
  '• เพิ่มหลาย note: โน้ตทริป #ทริป แล้วขึ้นบรรทัดใหม่ทีละรายการ',
  '  หรือคั่นด้วย |: โน้ตทริป รายการ1 | รายการ2 #ทริป',
  '• ดู note: โน้ต (ชื่อทริป)',
  '',
  '━━ ⏰ แจ้งเตือน ━━',
  '• เลือกจากปฏิทิน: แจ้งเตือนใหม่',
  '• พิมพ์วันเอง: แจ้งเตือน 25 ธ.ค. 09:00 เช็คกระเป๋า',
  '• พูดแบบคน: เตือนพรุ่งนี้บ่ายสาม ซื้อนม / เตือนอีก 2 ชั่วโมง เอาผ้าออก / เตือนวันศุกร์หน้า 9 โมงเช้า โทรหาแม่',
  '• แจ้งทั้งคู่: เติม ทั้งคู่ หรือ #ชื่อทริป ท้ายข้อความ',
  '• ดูที่รออยู่: ดูแจ้งเตือน',
  '• ยกเลิก: ยกเลิกแจ้งเตือน [เลข]',
  '',
  '━━ 🔌 EV ━━',
  '• ตั้งค่าระยะรถ: ตั้งค่ารถ 400 กม.',
  '• หาจุดชาร์จ (แชร์ link): ส่ง Google Maps directions link แล้วบอกแบต %',
  '• หาจุดชาร์จ (ตำแหน่งปัจจุบัน): แชร์ตำแหน่ง → ส่งปลายทาง/Maps link/พิมพ์ชื่อ → บอกแบต %',
  '',
  '━━ 👤 ผู้ใช้ & ระบบ ━━',
  '• ดูรายชื่อ: ผู้ใช้',
  '• ลงทะเบียน: ลงทะเบียน (ชื่อ)',
  '• เปลี่ยนชื่อ: เปลี่ยนชื่อ (ชื่อใหม่)',
  '• ดูข้อความที่บอตไม่เข้าใจ: ข้อความที่ไม่เข้าใจ',
  '• ล้างข้อมูลทั้งหมด: reset-all → reset-confirm',
  '',
  'หมายเหตุ: รองรับผู้ใช้ได้สูงสุด 2 คนเท่านั้น',
].join('\n');

const YES_RE = /^(ใช่|yes|ok|เรียกเก็บเงิน)$/i;
const CANCEL_RE = /^(ยกเลิก|cancel|ไม่เอา)$/i;
const MAPS_URL_RE = /https?:\/\/(www\.google\.com\/maps|maps\.app\.goo\.gl|goo\.gl\/maps)/;
// Commands that never belong to a free-text flow (datetime picker reply)
const COMMAND_RE = /^(help|ช่วยเหลือ|manual|คู่มือ|reset-all|reset-confirm|ผู้ใช้|users|รายชื่อผู้ใช้|รับแล้ว|ยืนยันรับเงิน|รับเงินแล้ว|ได้รับแล้ว|เงินเข้าแล้ว|ใช่|yes|ok|เรียกเก็บเงิน|สรุป|จ่ายแล้ว|โอนแล้ว|ยกเลิกรายการล่าสุด|ยกเลิกรายการ|ยกเลิกล่าสุด|undo|ลบรายการ|ลบ\s*\d+|ข้อความที่ไม่เข้าใจ|ดูข้อความที่ไม่เข้าใจ|สรุปยอดเดือนนี้|สรุปเดือนนี้|ค่าใช้จ่ายเดือนนี้|ทริป|trips|รายการทริป|แจ้งเตือนใหม่|ดูแจ้งเตือน)$|^(สร้างทริป|สรุปทริป|ปิดทริป|เปิดทริป|เพิ่มที่|ลบที่|ที่เที่ยว|เส้นทางทริป|โน้ตทริป|ตั้งค่ารถ|ยกเลิกแจ้งเตือน|ลงทะเบียน|เปลี่ยนชื่อ|terminate\s+user|restore\s+user)/i;

// ประโยคที่บอกว่าใครจ่าย/เลี้ยงใคร parser เดิมอ่านไม่ออก (มันเห็นแค่ "ชื่อ + ตัวเลข") → ให้ Claude ตีความก่อน
const NL_CUE_RE = /(ออกให้|เลี้ยง|จ่ายแทน|แฟนออก|แฟนจ่าย|ออกค่า|จ่ายให้|โอนให้|ยืม|คืน|ทด(?:ให้|ไว้|ก่อน)|สำรอง|ฝากจ่าย|ฝากซื้อ|ต้องคืน|ขอคืน)/;

// คำถาม: parser เดิมเห็นตัวเลขในประโยคแล้วบันทึกเป็นรายการ (เช่น ถามว่าใช้ไป 3 ครั้งไหม จะกลายเป็น 3 บาท) จึงส่งให้โมเดลก่อน
const QUESTION_CUE_RE = /(เท่าไหร่|เท่าไร|กี่(?:บาท|ครั้ง|รายการ)|ไหม(?!้)|หรือเปล่า|หรือยัง|\?)/;

function isSlipReply(text) {
  return YES_RE.test(text)
    || CANCEL_RE.test(text)
    || /(ส่วนตัว|ไม่หาร|private|personal)/i.test(text)
    || /(?:^|\s)(?:หาร|split)\s*\d+/i.test(text)
    || /^\d+\s*\/\s*\d+$/.test(text)
    || /(ฉัน|แฟน)\s*\d/.test(text)
    || /^\S+\s*\d+(\.\d+)?\s+\S+\s*\d+(\.\d+)?$/.test(text);
}

function isEvReply(text, pending) {
  if (MAPS_URL_RE.test(text) || /^\d+%?$/.test(text)) return true;
  // location flow รอปลายทาง: ข้อความอิสระถือเป็นคำตอบ (handler จะแจ้งรูปแบบที่ถูกต้อง) ยกเว้นเป็นคำสั่งอื่น
  return pending.type === 'location' && !pending.destination && !COMMAND_RE.test(text);
}

// A pending flow only survives if the new message is a reply to it;
// otherwise drop it so a later "ใช่"/number doesn't resurrect the old flow.
function dropStalePendingFlows(text, lineUserId) {
  const slip = slipConfirmState.pendingByUser[lineUserId];
  if (slip && !isSlipReply(text)) delete slipConfirmState.pendingByUser[lineUserId];

  const ev = evRouteState.pendingByUser[lineUserId];
  if (ev && !isEvReply(text, ev)) delete evRouteState.pendingByUser[lineUserId];

  if (deleteConfirmState.pendingByUser[lineUserId] && !YES_RE.test(text)) {
    delete deleteConfirmState.pendingByUser[lineUserId];
  }

  const nlPending = nlCommandState.pendingByUser[lineUserId];
  if (nlPending && (!(YES_RE.test(text) || CANCEL_RE.test(text)) || Date.now() - nlPending.createdAt > 10 * 60 * 1000)) {
    delete nlCommandState.pendingByUser[lineUserId];
  }

  if (deleteListState.pendingByUser[lineUserId] && !/^ลบ\s*\d+$/.test(text)) {
    delete deleteListState.pendingByUser[lineUserId];
  }

  if (datetimePickerState.pendingByUser[lineUserId] && COMMAND_RE.test(text)) {
    delete datetimePickerState.pendingByUser[lineUserId];
  }
}

// ผลจาก NL layer: ถ้าเป็น intent อื่น (คำสั่ง/ตั้งเตือน/ถามข้อมูล) ให้ส่งต่อ ไม่ใช่ก็คืนตามเดิม
async function finishNl(nl, userContext) {
  if (nl.type !== 'nl_other') return nl;
  const dispatched = await dispatchOtherIntent(nl.other, userContext, (text) => handleTextMessage(text, userContext));
  return dispatched || { type: 'noop', reply: 'ขอโทษครับ ยังไม่เข้าใจข้อความนี้ พิมพ์ help เพื่อดูคำสั่ง' };
}

async function handleTextMessage(text, userContext = {}) {
  const normalized = String(text || '').trim();
  const lineUserId = userContext.lineUserId || 'unknown';

  if (!normalized) {
    return { type: 'noop', reply: 'ไม่มีข้อความให้ประมวลผล' };
  }

  dropStalePendingFlows(normalized, lineUserId);

  // ผู้ใช้ตอบรับ/ปฏิเสธคำสั่งที่ AI ตีความไว้
  const pendingNl = nlCommandState.pendingByUser[lineUserId];
  if (pendingNl) {
    delete nlCommandState.pendingByUser[lineUserId];
    if (YES_RE.test(normalized)) return handleTextMessage(pendingNl.canonical, userContext);
    return { type: 'noop', reply: 'ยกเลิกแล้ว' };
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

  if (/^(ข้อความที่ไม่เข้าใจ|ดูข้อความที่ไม่เข้าใจ)$/i.test(normalized)) {
    return handleListUnrecognized();
  }

  const deleteListMatch = normalized.match(/^ลบรายการ(?:\s+(.+))?$/i);
  if (deleteListMatch) {
    return handleListDeletableExpenses(deleteListMatch[1], userContext);
  }

  const pickDeleteMatch = normalized.match(/^ลบ\s*(\d+)$/i);
  if (pickDeleteMatch) {
    return handlePickDeleteExpense(Number.parseInt(pickDeleteMatch[1], 10), userContext);
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

  const closeTripMatch = normalized.match(/^ปิดทริป\s*(.+)$/i);
  if (closeTripMatch) {
    return handleSetTripBillable(closeTripMatch[1].trim(), true);
  }

  const openTripMatch = normalized.match(/^เปิดทริป\s*(.+)$/i);
  if (openTripMatch) {
    return handleSetTripBillable(openTripMatch[1].trim(), false);
  }

  const addPlaceMatch = normalized.match(/^เพิ่มที่\s*(.+)$/i);
  if (addPlaceMatch) {
    return handleAddPlace(addPlaceMatch[1].trim());
  }

  const deletePlaceMatch = normalized.match(/^ลบที่\s*(.+)$/i);
  if (deletePlaceMatch) {
    return handleDeletePlace(deletePlaceMatch[1].trim());
  }

  const visitedMatch = normalized.match(/^(?:ไปแล้ว|✓)\s+(.+)$/i);
  if (visitedMatch) {
    return handleMarkVisited(visitedMatch[1].trim());
  }

  const listPlacesMatch = normalized.match(/^ที่เที่ยว\s*(.+)$/i);
  if (listPlacesMatch) {
    return handleListPlaces(listPlacesMatch[1].trim());
  }

  const tripRouteMatch = normalized.match(/^เส้นทางทริป\s*(.+)$/i);
  if (tripRouteMatch) {
    return handleTripRoute(tripRouteMatch[1].trim());
  }

  const addNoteMatch = normalized.match(/^โน้ตทริป\s*([\s\S]+)$/i);
  if (addNoteMatch) {
    return handleAddNote(addNoteMatch[1].trim());
  }

  const listNotesMatch = normalized.match(/^โน้ต\s+(.+)$/i);
  if (listNotesMatch) {
    return handleListNotes(listNotesMatch[1].trim());
  }

  if (/^แจ้งเตือนใหม่$/i.test(normalized)) {
    return handleShowDatetimePicker();
  }

  if (datetimePickerState.pendingByUser[lineUserId]) {
    const { scheduledAt } = datetimePickerState.pendingByUser[lineUserId];
    delete datetimePickerState.pendingByUser[lineUserId];
    return handleScheduleFromDatetime(normalized, scheduledAt, lineUserId);
  }

  const notifMatch = normalized.match(/^แจ้งเตือน\s+(.+)$/i);
  if (notifMatch) {
    return handleScheduleNotification(notifMatch[1].trim(), lineUserId);
  }

  // "เตือนพรุ่งนี้บ่ายสามซื้อนม" (ไม่มีคำว่า แจ้ง และไม่ใช่ แจ้งเตือนใหม่)
  const remindMatch = normalized.match(/^เตือน\s*(.+)$/i);
  if (remindMatch) {
    return handleScheduleNotification(remindMatch[1].trim(), lineUserId);
  }

  if (/^ดูแจ้งเตือน$/i.test(normalized)) {
    return handleListNotifications();
  }

  const cancelNotifMatch = normalized.match(/^ยกเลิกแจ้งเตือน\s+(.+)$/i);
  if (cancelNotifMatch) {
    return handleCancelNotification(cancelNotifMatch[1].trim());
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

  // ขั้นตอนเตรียมข้อความบันทึกค่าใช้จ่าย: เลขไทย ("สามร้อย" → 300) และวลีวันที่ ("เมื่อวาน" → ย้อนหลัง)
  const numbered = normalizeThaiNumbers(normalized);
  const { text: expenseText, createdAt } = extractDatePhrase(numbered);
  const expenseContext = createdAt ? { ...userContext, createdAt } : userContext;

  const inputLines = expenseText.split('\n').map((l) => l.trim()).filter(Boolean);
  const isQuestion = QUESTION_CUE_RE.test(expenseText);
  if (inputLines.length === 1 && (NL_CUE_RE.test(expenseText) || isQuestion)) {
    const cued = await handleNaturalLanguageExpense(expenseText, expenseContext);
    if (cued) return finishNl(cued, userContext);
    // ยืมเงินแต่ตีความไม่ได้ → อย่าให้ parser เดิมบันทึกเป็นหารครึ่งแบบเงียบๆ
    if (/ยืม/.test(expenseText)) {
      return { type: 'error', reply: 'ไม่แน่ใจว่าใครยืมใคร กรุณาพิมพ์ เช่น ปิ๊กยืมแจม 500 (คนยืม + ยืม + คนให้ยืม + ยอด)' };
    }
    if (isQuestion) {
      return { type: 'noop', reply: 'ขอโทษครับ ยังไม่เข้าใจคำถามนี้ ลองถามใหม่ เช่น เดือนนี้ใช้ไปเท่าไหร่ หรือ ตอนนี้ใครต้องจ่ายใคร' };
    }
  }

  const result = await handleExpenseLines(inputLines, expenseContext);
  if (result.type !== 'noop') return result;

  // parser เดิมหาจำนวนเงินไม่เจอ → ลองให้ Claude ตีความข้อความภาษาธรรมชาติ
  const nlResult = await handleNaturalLanguageExpense(expenseText, expenseContext);
  if (!nlResult) return result;
  if (nlResult.type === 'nl_other') return finishNl(nlResult, userContext);
  // ข้อความที่ไม่มีตัวเลข (ทักทาย/คุยเล่น) ไม่ต้องรายงานว่า AI ล้ม — ตอบเงียบๆ แบบเดิม
  if (nlResult.type === 'error' && !/\d/.test(expenseText)) return result;
  return nlResult;
}

module.exports = { handleTextMessage };
