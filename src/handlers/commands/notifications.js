const { scheduleNotification, listPendingNotifications, cancelNotificationById } = require('../../services/db');
const { parseNotificationInput, toLocalDisplay } = require('../../utils/parse-date');

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

  const parsed = parseNotificationInput(cleanInput);
  if (!parsed) {
    return { type: 'error', reply: 'รูปแบบไม่ถูกต้อง เช่น แจ้งเตือน 25 ธ.ค. 09:00 เช็คกระเป๋า' };
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

async function handleListNotifications() {
  const list = await listPendingNotifications();
  if (!list.length) {
    return { type: 'notifications', reply: 'ยังไม่มีแจ้งเตือนที่รออยู่\nตั้งได้ด้วย: แจ้งเตือน 25 ธ.ค. 09:00 ข้อความ' };
  }

  const lines = ['⏰ แจ้งเตือนที่รออยู่\n'];
  list.forEach((n, i) => {
    lines.push(`${i + 1}. ${toLocalDisplay(new Date(n.scheduled_at))} — ${n.message}`);
  });
  lines.push('\nยกเลิกด้วย: ยกเลิกแจ้งเตือน [เลข]');
  return { type: 'notifications', reply: lines.join('\n') };
}

async function handleCancelNotification(input) {
  const num = parseInt(input.trim());
  if (isNaN(num) || num < 1) {
    return { type: 'error', reply: 'ระบุหมายเลขแจ้งเตือน เช่น ยกเลิกแจ้งเตือน 1' };
  }

  const list = await listPendingNotifications();
  const target = list[num - 1];
  if (!target) {
    return { type: 'error', reply: `ไม่พบแจ้งเตือนหมายเลข ${num}` };
  }

  await cancelNotificationById(target.id);
  return { type: 'notification_cancelled', reply: `ยกเลิกแจ้งเตือน "${target.message}" แล้ว` };
}

module.exports = { handleShowDatetimePicker, handleScheduleFromDatetime, handleScheduleNotification, handleListNotifications, handleCancelNotification };
