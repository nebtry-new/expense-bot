const test = require('node:test');
const assert = require('node:assert/strict');
const { resetData, registerUser, listOpenBillingRequests, getExpenses, deleteExpenseById } = require('../src/services/db');
const { handleTextMessage } = require('../src/handlers/text');
const { clearAllState } = require('../src/handlers/state');
const { runBillingReminders } = require('../src/services/billing-reminders');
const { atReminderHourAfterDays } = require('../src/utils/reminder-time');

const u1 = { lineUserId: 'u1' };
const u2 = { lineUserId: 'u2' };

function recorder(result = true) {
  const sent = [];
  return { sent, fn: async (to, message) => { sent.push({ to, message }); return result; } };
}

// ปิ๊กออกค่าข้าว 100 → แจมค้าง 50; ปิ๊กสรุปแล้วตอบ ใช่ = เรียกเก็บ
async function billed() {
  await resetData();
  clearAllState();
  await registerUser({ lineUserId: 'u1', displayName: 'ปิ๊ก' });
  await registerUser({ lineUserId: 'u2', displayName: 'แจม' });
  await handleTextMessage('ค่าข้าว 100', u1);
  await handleTextMessage('สรุป', u1);
  const r = await handleTextMessage('ใช่', u1);
  assert.equal(r.type, 'settlement_trigger');
  const [req] = await listOpenBillingRequests();
  return { req, base: new Date(req.requestedAt).getTime() };
}

test('เรียกเก็บแล้วลูกหนี้ยังไม่จ่าย → เตือนวันที่ 3 และวันที่ 7 เวลา 09:00 (ไทย) พร้อมปุ่ม จ่ายแล้ว', async () => {
  const { base } = await billed();
  const d3 = atReminderHourAfterDays(base, 3);
  const d7 = atReminderHourAfterDays(base, 7);
  const { fn, sent } = recorder();

  assert.deepEqual(await runBillingReminders(fn, d3 - 60000), { sent: 0 });

  assert.deepEqual(await runBillingReminders(fn, d3 + 1000), { sent: 1 });
  assert.equal(sent[0].to, 'u2'); // เตือนลูกหนี้ (แจม)
  assert.ok(sent[0].message.text.includes('ยังไม่ได้จ่ายให้ ปิ๊ก') && sent[0].message.text.includes('50.00'), sent[0].message.text);
  assert.equal(sent[0].message.quickReply.items[0].action.text, 'จ่ายแล้ว');

  assert.deepEqual(await runBillingReminders(fn, d3 + 3600000), { sent: 0 }); // ไม่ซ้ำ
  assert.deepEqual(await runBillingReminders(fn, d7 + 1000), { sent: 1 });
  assert.ok(sent[1].message.text.includes('ครบ 7 วัน'), sent[1].message.text);
  assert.deepEqual(await runBillingReminders(fn, d7 + 30 * 86400000), { sent: 0 }); // หลังวันที่ 7 ไม่เตือนอีก
});

test('ลูกหนี้กด จ่ายแล้ว → หยุดเตือนค้างชำระ', async () => {
  const { base } = await billed();
  await handleTextMessage('จ่ายแล้ว', u2);
  assert.equal((await listOpenBillingRequests()).length, 0);
  const { fn, sent } = recorder();
  assert.deepEqual(await runBillingReminders(fn, atReminderHourAfterDays(base, 3) + 1000), { sent: 0 });
  assert.equal(sent.length, 0);
});

test('ไม่มียอดค้างแล้ว (เช่น ลบรายการไป) → ปิดเรื่องเงียบๆ ไม่เตือนผิด', async () => {
  const { base } = await billed();
  for (const e of await getExpenses()) await deleteExpenseById(e.id);
  const { fn, sent } = recorder();
  assert.deepEqual(await runBillingReminders(fn, atReminderHourAfterDays(base, 3) + 1000), { sent: 0 });
  assert.equal(sent.length, 0);
  assert.equal((await listOpenBillingRequests()).length, 0);
});

test('เซิร์ฟเวอร์ดับข้ามทั้งวันที่ 3 และ 7 → ส่งครั้งเดียว (ข้อความ 7 วัน) ไม่ส่งซ้อนสองครั้ง', async () => {
  const { base } = await billed();
  const { fn, sent } = recorder();
  assert.deepEqual(await runBillingReminders(fn, base + 10 * 86400000), { sent: 1 });
  assert.ok(sent[0].message.text.includes('ครบ 7 วัน'));
  assert.deepEqual(await runBillingReminders(fn, base + 10 * 86400000 + 60000), { sent: 0 });
});

test('ส่งเตือนค้างชำระไม่สำเร็จ → ไม่นับว่าเตือนแล้ว ลองใหม่รอบหน้า', async () => {
  const { base } = await billed();
  const due = atReminderHourAfterDays(base, 3) + 1000;
  assert.deepEqual(await runBillingReminders(recorder(false).fn, due), { sent: 0 });
  assert.deepEqual(await runBillingReminders(recorder(true).fn, due + 60000), { sent: 1 });
});
