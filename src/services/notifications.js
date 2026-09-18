const { getPendingNotifications, markNotificationSent, getUsers } = require('./db');

async function runPendingNotifications(sendPushFn) {
  const pending = await getPendingNotifications();
  if (!pending.length) return { sent: 0 };

  const users = await getUsers();
  const lineUserIds = users.map((u) => u.lineUserId).filter(Boolean);
  if (!lineUserIds.length) return { sent: 0 };

  let sent = 0;
  for (const notif of pending) {
    const targets = notif.line_user_id
      ? lineUserIds.filter((id) => id === notif.line_user_id)
      : lineUserIds;
    for (const lineUserId of targets) {
      await sendPushFn(lineUserId, `🔔 ${notif.message}`);
    }
    await markNotificationSent(notif.id);
    sent++;
  }

  return { sent };
}

module.exports = { runPendingNotifications };
