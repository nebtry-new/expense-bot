const test = require('node:test');
const assert = require('node:assert/strict');
const { parseRelativeReminder } = require('../src/utils/relative-time');
const { handleTextMessage } = require('../src/handlers/text');
const { resetData, registerUser, listPendingNotifications } = require('../src/services/db');

// Monday 2026-11-02 10:00 Thai time
const NOW = new Date('2026-11-02T03:00:00Z');
const local = (r) => new Date(r.scheduledAt.getTime() + 7 * 3600000).toISOString().slice(0, 16);

const CASES = [
  ['พรุ่งนี้บ่ายสามซื้อนม', '2026-11-03T15:00', 'ซื้อนม'],
  ['วันศุกร์หน้า 9 โมงเช้า โทรหาแม่', '2026-11-06T09:00', 'โทรหาแม่'],
  ['อีก 2 ชั่วโมง ออกจากบ้าน', '2026-11-02T12:00', 'ออกจากบ้าน'],
  ['20.30 กินยา', '2026-11-02T20:30', 'กินยา'],
  ['09:00 ซื้อนม', '2026-11-03T09:00', 'ซื้อนม'], // เวลาผ่านแล้ววันนี้ → พรุ่งนี้
  ['พรุ่งนี้ซื้อของขวัญ', '2026-11-03T09:00', 'ซื้อของขวัญ'], // ไม่ระบุเวลา → 09:00
  ['สองทุ่มครึ่ง ดูหนัง', '2026-11-02T20:30', 'ดูหนัง'],
  ['บ่ายโมง ประชุม', '2026-11-02T13:00', 'ประชุม'],
  ['มะรืนนี้ตีห้า ไปสนามบิน', '2026-11-04T05:00', 'ไปสนามบิน'],
  ['อีกครึ่งชั่วโมง เอาผ้าออก', '2026-11-02T10:30', 'เอาผ้าออก'],
  ['คืนนี้ 3 ทุ่ม โทรหาแฟน', '2026-11-02T21:00', 'โทรหาแฟน'],
  ['พรุ่งนี้เที่ยง กินข้าวกับแม่', '2026-11-03T12:00', 'กินข้าวกับแม่'],
];

for (const [text, when, message] of CASES) {
  test(`relative reminder: "${text}"`, () => {
    const r = parseRelativeReminder(text, NOW);
    assert.equal(local(r), when);
    assert.equal(r.message, message);
  });
}

test('relative reminder: past / no message / no time phrase', () => {
  assert.equal(parseRelativeReminder('วันนี้ 8:00 ตื่น', NOW).error, 'past');
  assert.equal(parseRelativeReminder('พรุ่งนี้ 10:00', NOW).error, 'no_message');
  assert.equal(parseRelativeReminder('ซื้อนม', NOW), null);
});

test('"เตือน…" command schedules in the DB (Thai wall-clock time)', async () => {
  await resetData();
  await registerUser({ lineUserId: 'u1', displayName: 'ปิ๊ก' });
  const r = await handleTextMessage('เตือนพรุ่งนี้บ่ายสามซื้อนม', { lineUserId: 'u1' });
  assert.equal(r.type, 'notification_set');

  const [n] = await listPendingNotifications();
  assert.equal(n.message, 'ซื้อนม');
  const thaiHour = new Date(new Date(n.scheduled_at).getTime() + 7 * 3600000).getUTCHours();
  assert.equal(thaiHour, 15);
  assert.equal(n.line_user_id, 'u1'); // เฉพาะคนตั้ง
});

test('"เตือน … ทั้งคู่" broadcasts; unreadable time gives a helpful error', async () => {
  await resetData();
  await registerUser({ lineUserId: 'u1', displayName: 'ปิ๊ก' });
  const both = await handleTextMessage('แจ้งเตือน พรุ่งนี้ 10:00 ซื้อนม ทั้งคู่', { lineUserId: 'u1' });
  assert.equal(both.type, 'notification_set');
  assert.equal((await listPendingNotifications())[0].line_user_id, null);

  const bad = await handleTextMessage('เตือนซื้อนม', { lineUserId: 'u1' });
  assert.equal(bad.type, 'error');
  assert.ok(bad.reply.includes('เตือนพรุ่งนี้บ่ายสาม'));
});
