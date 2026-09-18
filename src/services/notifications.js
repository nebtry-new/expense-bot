const { getPendingNotifications, markNotificationSent, getUsers } = require('./db');

async function runPendingNotifications(sendPushFn) {
  const pending = await getPendingNotifications();
  if (!pending.length) return { sent: 0 };

  const users = await getUsers();
  const lineUserIds = users.map((u) => u.lineUserId).filter(Boolean);
  if (!lineUserIds.length) return { sent: 0 };

  let sent = 0;
  for (const notif of pending) {
    for (const lineUserId of lineUserIds) {
      await sendPushFn(lineUserId, `🔔 ${notif.message}`);
    }
    await markNotificationSent(notif.id);
    sent++;
  }

  return { sent };
}

module.exports = { runPendingNotifications };
