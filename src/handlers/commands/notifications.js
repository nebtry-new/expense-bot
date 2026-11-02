const { scheduleNotification, listPendingNotifications, getPendingNotifications, cancelNotificationById, getDbStatus } = require('../../services/db');
const { notifListState } = require('../state');
const { schedulerStatus } = require('../../services/notifications');
const { parseNotificationInput, toLocalDisplay } = require('../../utils/parse-date');
const { parseRelativeReminder } = require('../../utils/relative-time');

function handleShowDatetimePicker() {
  const now = new Date();
  const localNow = new Date(now.getTime() + 7 * 60 * 60 * 1000);
  const min = localNow.toISOString().slice(0, 16);
  const max = `${localNow.getUTCFullYear() + 1}-12-31T23:59`;

  return {
    type: 'datetime_picker',
    replyMessage: {
      type: 'template',
      altText: 'เลือกวันเวลาแจ้งเตือน',
      template: {
        type: 'buttons',
        text: 'เลือกวันและเวลาที่ต้องการแจ้งเตือน',
        actions: [{
          type: 'datetimepicker',
          label: '📅 เลือกวันเวลา',
          data: 'action=pick_notif_datetime',
          mode: 'datetime',
          min,
          max,
        }],
      },
    },
  };
}

async function handleScheduleFromDatetime(message, scheduledAt, lineUserId) {
  const BROADCAST_KW = /\s+ทั้งคู่$/;
  const HAS_TRIP_TAG = /#[฀-๿a-zA-Z0-9_]+/.test(message);
  const broadcast = HAS_TRIP_TAG || BROADCAST_KW.test(message);
  const cleanMessage = message.replace(BROADCAST_KW, '').trim();

  if (!cleanMessage) {
    return { type: 'error', reply: 'ระบุข้อความแจ้งเตือนด้วย' };
  }

  await scheduleNotification({ message: cleanMessage, scheduledAt, lineUserId: broadcast ? null : lineUserId });
  const scope = broadcast ? '(ทั้งคู่)' : '(เฉพาะคุณ)';
  return {
    type: 'notification_set',
    reply: `⏰ ตั้งแจ้งเตือน ${scope}: ${toLocalDisplay(scheduledAt)} น.\n"${cleanMessage}"`,
  };
}

async function handleScheduleNotification(input, lineUserId) {
  const BROADCAST_KW = /\s+ทั้งคู่$/;
  const HAS_TRIP_TAG = /#[฀-๿a-zA-Z0-9_]+/.test(input);
  const broadcast = HAS_TRIP_TAG || BROADCAST_KW.test(input);
  const cleanInput = input.replace(BROADCAST_KW, '').trim();

  let parsed = parseNotificationInput(cleanInput);
  if (!parsed) {
    // พูดแบบคน: "พรุ่งนี้บ่ายสามซื้อนม", "อีก 2 ชั่วโมง ...", "วันศุกร์หน้า 9 โมงเช้า ..."
    const rel = parseRelativeReminder(cleanInput);
    if (rel?.error === 'past') return { type: 'error', reply: 'วันเวลาที่ระบุผ่านไปแล้ว กรุณาระบุเวลาในอนาคต' };
    if (rel?.error === 'no_message') return { type: 'error', reply: 'ระบุข้อความที่จะให้เตือนด้วย เช่น เตือนพรุ่งนี้บ่ายสาม ซื้อนม' };
    if (rel?.error === 'bad_time') return { type: 'error', reply: 'เวลาไม่ถูกต้อง' };
    if (rel?.scheduledAt) parsed = rel;
  }
  if (!parsed) {
    return { type: 'error', reply: 'อ่านวันเวลาไม่ออก ลองพิมพ์ เช่น เตือนพรุ่งนี้บ่ายสาม ซื้อนม หรือ แจ้งเตือน 25 ธ.ค. 09:00 เช็คกระเป๋า' };
  }

  const { scheduledAt, message } = parsed;
  if (scheduledAt < new Date()) {
    return { type: 'error', reply: 'วันเวลาที่ระบุผ่านไปแล้ว กรุณาระบุวันในอนาคต' };
  }

  await scheduleNotification({ message, scheduledAt, lineUserId: broadcast ? null : lineUserId });
  const scope = broadcast ? '(ทั้งคู่)' : '(เฉพาะคุณ)';
  return {
    type: 'notification_set',
    reply: `⏰ ตั้งแจ้งเตือน ${scope}: ${toLocalDisplay(scheduledAt)} น.\n"${message}"`,
  };
}

const MAX_CANCEL_BUTTONS = 12; // + ปุ่ม ตั้งใหม่ = 13 (ขีดจำกัด quick reply)

async function handleListNotifications(lineUserId) {
  const list = await listPendingNotifications({ lineUserId });
  if (!list.length) {
    delete notifListState.pendingByUser[lineUserId];
    return {
      type: 'notifications',
      reply: 'ยังไม่มีแจ้งเตือนที่รออยู่\nตั้งได้ด้วย: แจ้งเตือน 25 ธ.ค. 09:00 ข้อความ',
      quickReplies: [{ label: '⏰ ตั้งแจ้งเตือนใหม่', text: 'แจ้งเตือนใหม่' }],
    };
  }

  // จำลำดับที่แสดงไว้ — ปุ่ม/เลขยกเลิกอ้างอิงจากลิสต์นี้ แม้มีแจ้งเตือนถูกส่งไปแล้วระหว่างนั้น
  notifListState.pendingByUser[lineUserId] = list.map((n) => n.id);

  const lines = ['⏰ แจ้งเตือนที่รออยู่\n'];
  list.forEach((n, i) => {
    lines.push(`${i + 1}. ${toLocalDisplay(new Date(n.scheduled_at))} — ${n.message}${n.line_user_id ? '' : ' (ทั้งคู่)'}`);
  });
  lines.push('\nแตะปุ่ม ❌ เพื่อยกเลิก หรือพิมพ์ ยกเลิกแจ้งเตือน [เลข]');
  return {
    type: 'notifications',
    reply: lines.join('\n'),
    quickReplies: [
      ...list.slice(0, MAX_CANCEL_BUTTONS).map((n, i) => ({ label: `❌ ${i + 1}. ${n.message}`, text: `ยกเลิกแจ้งเตือน ${i + 1}` })),
      { label: '⏰ ตั้งใหม่', text: 'แจ้งเตือนใหม่' },
    ],
  };
}

async function handleCancelNotification(input, lineUserId) {
  const num = parseInt(input.trim());
  if (isNaN(num) || num < 1) {
    return { type: 'error', reply: 'ระบุหมายเลขแจ้งเตือน เช่น ยกเลิกแจ้งเตือน 1' };
  }

  const list = await listPendingNotifications({ lineUserId });
  const snapshot = notifListState.pendingByUser[lineUserId];
  // มีลิสต์ที่เพิ่งแสดง → เลขหมายถึงรายการในลิสต์นั้น; ไม่มี → ใช้ลิสต์ปัจจุบัน
  const target = snapshot ? list.find((n) => n.id === snapshot[num - 1]) : list[num - 1];
  if (!target) {
    delete notifListState.pendingByUser[lineUserId];
    return snapshot && snapshot[num - 1]
      ? { type: 'error', reply: 'แจ้งเตือนนี้ถูกส่งหรือยกเลิกไปแล้ว', quickReplies: [{ label: 'ดูแจ้งเตือน', text: 'ดูแจ้งเตือน' }] }
      : { type: 'error', reply: `ไม่พบแจ้งเตือนหมายเลข ${num}` };
  }

  await cancelNotificationById(target.id);
  // แสดงลิสต์ที่เหลือพร้อมปุ่มต่อ จะได้ยกเลิกรายการอื่นต่อได้ทันที
  const remaining = await handleListNotifications(lineUserId);
  return {
    type: 'notification_cancelled',
    reply: `ยกเลิกแจ้งเตือน "${target.message}" แล้ว\n\n${remaining.reply}`,
    quickReplies: remaining.quickReplies,
  };
}

// ตรวจว่าระบบแจ้งเตือนทำงานอยู่ไหม — ใช้ไล่ปัญหา "ตั้งแล้วไม่เตือน"
async function handleNotificationStatus(lineUserId) {
  const [mine, due] = await Promise.all([listPendingNotifications({ lineUserId }), getPendingNotifications()]);
  const s = schedulerStatus;
  const ago = (iso) => (iso ? `${Math.round((Date.now() - new Date(iso).getTime()) / 1000)} วินาทีที่แล้ว` : 'ยังไม่เคย');
  const lines = [
    '🔧 สถานะระบบแจ้งเตือน',
    `ตัวรันในเซิร์ฟเวอร์: ${s.started ? `ทำงาน (ทุก ${Math.round(s.intervalMs / 1000)} วิ)` : 'ไม่ได้ทำงาน ❌'}`,
    `เริ่มเมื่อ: ${s.startedAt ? toLocalDisplay(new Date(s.startedAt)) + ' น.' : '-'}`,
    `รันล่าสุด: ${ago(s.lastRunAt)}${s.lastResult ? ` (ส่งได้ ${s.lastResult.sent}, ล้มเหลว ${s.lastResult.failed})` : ''}`,
    s.lastError ? `error ล่าสุด: ${s.lastError}` : null,
    `ฐานข้อมูล: ${getDbStatus().mode}`,
    `แจ้งเตือนที่รออยู่ของคุณ: ${mine.length} · ถึงเวลาแล้วแต่ยังไม่ส่ง (ทั้งระบบ): ${due.length}`,
  ].filter(Boolean);
  return { type: 'notification_status', reply: lines.join('\n') };
}

module.exports = { handleNotificationStatus, handleShowDatetimePicker, handleScheduleFromDatetime, handleScheduleNotification, handleListNotifications, handleCancelNotification };
