const test = require('node:test');
const assert = require('node:assert/strict');
const { resetData, registerUser, addExpense } = require('../src/services/db');
const { handleTextMessage } = require('../src/handlers/text');
const { __setClassifier, __resetAttempted } = require('../src/services/categorize');

const u1 = { lineUserId: 'u1' };

async function setup() {
  await resetData();
  __resetAttempted();
  __setClassifier(null);
  await registerUser({ lineUserId: 'u1', displayName: 'ปิ๊ก' });
  await registerUser({ lineUserId: 'u2', displayName: 'แจม' });
}

test('ตั้งงบ / ดูงบ / ลบงบ + หมวดที่ไม่รู้จักหรือรูปแบบผิด', async () => {
  await setup();
  assert.equal((await handleTextMessage('ตั้งงบ อาหาร 5000', u1)).type, 'budget_set');
  assert.equal((await handleTextMessage('ตั้งงบ เดินทาง 2,000 บาท', u1)).type, 'budget_set');
  assert.equal((await handleTextMessage('ตั้งงบ xyz 100', u1)).type, 'error');
  assert.equal((await handleTextMessage('ตั้งงบ อื่นๆ 100', u1)).type, 'error'); // other ตั้งงบไม่ได้
  assert.equal((await handleTextMessage('ตั้งงบ อาหาร', u1)).type, 'error');

  const list = await handleTextMessage('ดูงบ', u1);
  assert.ok(list.reply.includes('อาหาร: 0 / 5,000') && list.reply.includes('เดินทาง: 0 / 2,000'), list.reply);

  assert.equal((await handleTextMessage('ลบงบ อาหาร', u1)).type, 'budget_deleted');
  assert.equal((await handleTextMessage('ลบงบ อาหาร', u1)).type, 'noop');
  assert.ok(!(await handleTextMessage('ดูงบ', u1)).reply.includes('อาหาร:'));
});

test('แจ้งเตือนงบ: เตือนครั้งเดียวตอนข้าม 80% และครั้งเดียวตอนเกิน 100% ไม่เตือนซ้ำทุกรายการ', async () => {
  await setup();
  await handleTextMessage('ตั้งงบ อาหาร 1000', u1);

  assert.ok(!(await handleTextMessage('ค่าข้าว 700', u1)).reply.includes('งบ'));
  const warn = await handleTextMessage('ค่าข้าว 150', u1); // 850 = 85%
  assert.ok(warn.reply.includes('⚠️') && warn.reply.includes('ใกล้เต็มงบ'), warn.reply);
  assert.ok(!(await handleTextMessage('ค่าข้าว 50', u1)).reply.includes('งบ')); // 900 ยังไม่ข้ามเส้นใหม่

  const over = await handleTextMessage('ค่าข้าว 200', u1); // 1100
  assert.ok(over.reply.includes('🚨') && over.reply.includes('เกิน 100'), over.reply);
  assert.ok(!(await handleTextMessage('ค่าข้าว 10', u1)).reply.includes('งบ')); // เกินไปแล้ว ไม่เตือนซ้ำ

  // หมวดอื่นที่ไม่มีงบ ไม่เตือน
  assert.ok(!(await handleTextMessage('ค่าไฟ 5000', u1)).reply.includes('งบ'));
});

test('บันทึกหลายรายการในครั้งเดียวที่รวมกันข้ามเส้น → เตือนครั้งเดียวของหมวดนั้น', async () => {
  await setup();
  await handleTextMessage('ตั้งงบ อาหาร 1000', u1);
  const r = await handleTextMessage('ค่าข้าว 500\nค่ากาแฟ 450', u1);
  assert.equal(r.type, 'expense_batch');
  assert.equal(r.reply.split('ใกล้เต็มงบ').length - 1, 1, r.reply);
});

test('ยอดเดือนก่อนไม่นับเข้างบเดือนนี้', async () => {
  await setup();
  await handleTextMessage('ตั้งงบ อาหาร 1000', u1);
  const lastMonth = new Date(Date.now() - 40 * 24 * 3600 * 1000);
  await addExpense({ paidByUserId: 'x', description: 'ค่าข้าว', amount: 900, createdAt: lastMonth });
  const r = await handleTextMessage('ค่าข้าว 100', u1);
  assert.ok(!r.reply.includes('งบ'), r.reply);
  assert.ok((await handleTextMessage('ดูงบ', u1)).reply.includes('อาหาร: 100 / 1,000 บาท (10%)'));
});

test('สรุปเดือนนี้ แยกหมวดเรียงมาก→น้อย พร้อมเทียบงบ', async () => {
  await setup();
  await handleTextMessage('ตั้งงบ อาหาร 1000', u1);
  await handleTextMessage('ตั้งงบ ช้อปปิ้ง 3000', u1);
  await handleTextMessage('ค่าข้าว 900', u1);
  await handleTextMessage('ค่าไฟ 2000', u1);
  await handleTextMessage('ของจิปาถะ 100', u1);

  const r = await handleTextMessage('สรุปยอดเดือนนี้', u1);
  assert.equal(r.type, 'summary_monthly');
  assert.ok(r.reply.includes('รวมทั้งหมด: 3,000 บาท (3 รายการ)'), r.reply);
  const order = ['บ้าน/บิล: 2,000', 'อาหาร: 900 / 1,000 บาท (90%) ⚠️ ใกล้เต็ม', 'อื่นๆ: 100', 'ช้อปปิ้ง: 0 / 3,000'].map((t) => r.reply.indexOf(t));
  assert.ok(order.every((i) => i >= 0), r.reply);
  assert.deepEqual([...order].sort((a, b) => a - b), order); // เรียงตามยอดมาก→น้อย (หมวดงบที่ยังไม่ใช้ท้ายสุด)
  assert.deepEqual(r.quickReplies.map((q) => q.text), ['ดูงบ', 'จัดหมวด']);
});

test('จัดหมวด: จัดรายการเก่าด้วยกฎ และบอกผล', async () => {
  await setup();
  await addExpense({ paidByUserId: 'x', description: 'ค่าข้าว', amount: 10, category: 'other' });
  const r = await handleTextMessage('จัดหมวด', u1);
  assert.equal(r.type, 'categorize');
  assert.ok(r.reply.includes('จัดหมวดแล้ว 1 รายการ'), r.reply);
  assert.ok((await handleTextMessage('จัดหมวด', u1)).reply.includes('ครบแล้ว'));
});
