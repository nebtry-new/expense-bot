const { getPendingNotifications, claimNotification, releaseNotification, getUsers } = require('./db');

const MAX_ATTEMPTS = 5;
const attempts = new Map(); // notification id → จำนวนครั้งที่ส่งไม่สำเร็จ (ในหน่วยความจำ)

// สถานะตัวรันในตัวเซิร์ฟเวอร์ (index.js เป็นคนอัปเดต) — ไว้ตรวจด้วยคำสั่ง "ตรวจแจ้งเตือน"
const schedulerStatus = { started: false, intervalMs: null, startedAt: null, lastRunAt: null, lastResult: null, lastError: null, runs: 0 };

function __resetAttempts() {
  attempts.clear();
}

// sendPushFn(lineUserId, text) ต้องคืน true เมื่อส่งสำเร็จ (false/throw = ไม่สำเร็จ)
// ลำดับ: จอง (atomic) → ส่ง → ถ้าไม่มีใครได้รับเลยให้คืนสถานะไว้ลองใหม่รอบหน้า (สูงสุด MAX_ATTEMPTS ครั้ง)
async function runPendingNotifications(sendPushFn) {
  const pending = await getPendingNotifications();
  if (!pending.length) return { sent: 0, failed: 0, skipped: 0 };

  const users = await getUsers();
  const lineUserIds = users.map((u) => u.lineUserId).filter(Boolean);

  let sent = 0;
  let failed = 0;
  let skipped = 0;

  for (const notif of pending) {
    const claimed = await claimNotification(notif.id);
    if (!claimed) { skipped++; continue; } // มีตัวรันอื่นส่งไปแล้ว

    const targets = notif.line_user_id
      ? lineUserIds.filter((id) => id === notif.line_user_id)
      : lineUserIds;

    let delivered = 0;
    for (const lineUserId of targets) {
      try {
        if (await sendPushFn(lineUserId, `🔔 ${notif.message}`)) delivered++;
      } catch (err) {
        console.error('NOTIFICATION_PUSH_FAILED', { id: notif.id, error: err?.message || err });
      }
    }

    if (delivered > 0) {
      attempts.delete(notif.id);
      sent++;
      continue;
    }

    const tries = (attempts.get(notif.id) || 0) + 1;
    attempts.set(notif.id, tries);
    failed++;
    if (tries >= MAX_ATTEMPTS) {
      // ยอมแพ้: คงสถานะ "ส่งแล้ว" ไว้เพื่อไม่ให้วนไม่รู้จบ แต่ log ให้เห็น
      console.error('NOTIFICATION_GAVE_UP', { id: notif.id, message: notif.message, targets: targets.length });
      attempts.delete(notif.id);
    } else {
      await releaseNotification(notif.id);
    }
  }

  return { sent, failed, skipped };
}

module.exports = { runPendingNotifications, schedulerStatus, MAX_ATTEMPTS, __resetAttempts };
