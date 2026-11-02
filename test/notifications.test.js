const test = require('node:test');
const assert = require('node:assert/strict');
const { resetData, registerUser, scheduleNotification, listPendingNotifications } = require('../src/services/db');
const { runPendingNotifications, MAX_ATTEMPTS, __resetAttempts } = require('../src/services/notifications');
const { handleTextMessage } = require('../src/handlers/text');

const PAST = () => new Date(Date.now() - 1000);
const FUTURE = () => new Date(Date.now() + 3600 * 1000);

async function setup() {
  await resetData();
  __resetAttempts();
  await registerUser({ lineUserId: 'u1', displayName: 'ปิ๊ก' });
  await registerUser({ lineUserId: 'u2', displayName: 'แจม' });
}

function recorder(result = true) {
  const sent = [];
  const fn = async (to, text) => {
    sent.push({ to, text });
    return typeof result === 'function' ? result(to) : result;
  };
  return { fn, sent };
}

test('due notification is delivered once; future ones wait', async () => {
  await setup();
  await scheduleNotification({ message: 'ซื้อนม', scheduledAt: PAST(), lineUserId: 'u1' });
  await scheduleNotification({ message: 'ยังไม่ถึง', scheduledAt: FUTURE(), lineUserId: 'u1' });

  const push = recorder();
  assert.deepEqual(await runPendingNotifications(push.fn), { sent: 1, failed: 0, skipped: 0 });
  assert.deepEqual(push.sent, [{ to: 'u1', text: '🔔 ซื้อนม' }]);

  assert.equal((await runPendingNotifications(push.fn)).sent, 0); // ไม่ส่งซ้ำ
  assert.equal(push.sent.length, 1);
  assert.equal((await listPendingNotifications()).length, 1); // เหลือแค่อันอนาคต
});

test('broadcast goes to both users, private only to its owner', async () => {
  await setup();
  await scheduleNotification({ message: 'ทั้งคู่', scheduledAt: PAST(), lineUserId: null });
  await scheduleNotification({ message: 'ส่วนตัวแจม', scheduledAt: PAST(), lineUserId: 'u2' });

  const push = recorder();
  await runPendingNotifications(push.fn);
  assert.deepEqual(push.sent.map((p) => `${p.to}:${p.text}`).sort(), ['u1:🔔 ทั้งคู่', 'u2:🔔 ทั้งคู่', 'u2:🔔 ส่วนตัวแจม']);
});

test('failed push is NOT marked as sent — it is retried and delivered next run', async () => {
  await setup();
  await scheduleNotification({ message: 'สำคัญ', scheduledAt: PAST(), lineUserId: 'u1' });

  const down = recorder(false);
  assert.deepEqual(await runPendingNotifications(down.fn), { sent: 0, failed: 1, skipped: 0 });
  assert.equal((await listPendingNotifications()).length, 1); // ยังรออยู่

  const up = recorder(true);
  assert.equal((await runPendingNotifications(up.fn)).sent, 1);
  assert.equal((await listPendingNotifications()).length, 0);
});

test('a throwing push counts as a failure, and the loop gives up after MAX_ATTEMPTS', async () => {
  await setup();
  await scheduleNotification({ message: 'ส่งไม่ได้เลย', scheduledAt: PAST(), lineUserId: 'u1' });

  const boom = async () => { throw new Error('LINE down'); };
  for (let i = 0; i < MAX_ATTEMPTS; i++) await runPendingNotifications(boom);

  assert.equal((await listPendingNotifications()).length, 0); // ไม่วนไม่รู้จบ
  const after = recorder();
  assert.equal((await runPendingNotifications(after.fn)).sent, 0);
});

test('two runners at the same time never send the same notification twice', async () => {
  await setup();
  await scheduleNotification({ message: 'ครั้งเดียว', scheduledAt: PAST(), lineUserId: 'u1' });

  const push = recorder();
  const [a, b] = await Promise.all([runPendingNotifications(push.fn), runPendingNotifications(push.fn)]);
  assert.equal(push.sent.length, 1);
  assert.equal(a.sent + b.sent, 1);
});

test('notification for an unknown user is retried then abandoned (no infinite loop, no false "sent")', async () => {
  await setup();
  await scheduleNotification({ message: 'ผี', scheduledAt: PAST(), lineUserId: 'ghost' });
  const push = recorder();
  const first = await runPendingNotifications(push.fn);
  assert.equal(first.sent, 0);
  assert.equal(first.failed, 1);
  assert.equal(push.sent.length, 0);
});

test('ดูแจ้งเตือน / ยกเลิกแจ้งเตือน only see your own + broadcast', async () => {
  await setup();
  await scheduleNotification({ message: 'ของปิ๊ก', scheduledAt: FUTURE(), lineUserId: 'u1' });
  await scheduleNotification({ message: 'ความลับของแจม', scheduledAt: FUTURE(), lineUserId: 'u2' });
  await scheduleNotification({ message: 'ของทั้งคู่', scheduledAt: new Date(Date.now() + 2 * 3600 * 1000), lineUserId: null });

  const list = await handleTextMessage('ดูแจ้งเตือน', { lineUserId: 'u1' });
  assert.ok(list.reply.includes('ของปิ๊ก') && list.reply.includes('ของทั้งคู่ (ทั้งคู่)'));
  assert.ok(!list.reply.includes('ความลับของแจม'));

  // เลข 3 ไม่มีในลิสต์ของ u1 (มีแค่ 2 รายการ) แม้ใน DB จะมี 3 รายการ
  assert.equal((await handleTextMessage('ยกเลิกแจ้งเตือน 3', { lineUserId: 'u1' })).type, 'error');
  assert.equal((await listPendingNotifications()).length, 3);

  assert.equal((await handleTextMessage('ยกเลิกแจ้งเตือน 1', { lineUserId: 'u1' })).type, 'notification_cancelled');
  const left = (await listPendingNotifications()).map((n) => n.message).sort();
  assert.deepEqual(left, ['ความลับของแจม', 'ของทั้งคู่'].sort());
});

test('in-process scheduler starts unless NOTIFICATION_POLL_MS=0', () => {
  const { startNotificationScheduler } = require('../src/index');

  process.env.NOTIFICATION_POLL_MS = '0';
  assert.equal(startNotificationScheduler(), null);

  process.env.NOTIFICATION_POLL_MS = '60000';
  const timer = startNotificationScheduler();
  assert.ok(timer);
  clearInterval(timer);
  delete process.env.NOTIFICATION_POLL_MS;
});
