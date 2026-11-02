const test = require('node:test');
const assert = require('node:assert/strict');
const { handleTextMessage } = require('../src/handlers/text');
const { resetData, registerUser, getExpenses, deleteExpenseById } = require('../src/services/db');
const { clearAllState } = require('../src/handlers/state');
const { resetBillingOffers } = require('../src/handlers/commands/settlement');

const A = { lineUserId: 'u1' }; // ปิ๊ก
const B = { lineUserId: 'u2' }; // แจม

async function setup() {
  await resetData();
  clearAllState();
  resetBillingOffers();
  await registerUser({ lineUserId: 'u1', displayName: 'ปิ๊ก' });
  await registerUser({ lineUserId: 'u2', displayName: 'แจม' });
}

test('stale billing offer from an older summary can no longer be triggered', async () => {
  await setup();
  await handleTextMessage('ค่าโรงแรม 1000', A); // แจมค้างปิ๊ก 500
  const first = await handleTextMessage('สรุป', A);
  assert.ok(first.reply.includes('แจม ต้องจ่ายให้ ปิ๊ก 500.00'), first.reply);

  await handleTextMessage('ค่าทัวร์ 1100', B); // ตอนนี้ปิ๊กค้างแจม 50
  const second = await handleTextMessage('สรุป', B);
  assert.ok(second.reply.includes('ปิ๊ก ต้องจ่ายให้ แจม 50.00'), second.reply);

  // ปิ๊กพิมพ์เรียกเก็บเงิน → ต้องไม่ได้ข้อเสนอเก่า (แจมจ่าย 500)
  const stale = await handleTextMessage('เรียกเก็บเงิน', A);
  assert.notEqual(stale.type, 'settlement_trigger');
  assert.ok(stale.reply.includes('คุณเป็นฝ่ายต้องจ่าย 50.00 บาท ให้ แจม'), stale.reply);

  // แจม (เจ้าหนี้ตามสรุปล่าสุด) เรียกเก็บได้ และยอดตรงกับที่สรุป
  const ok = await handleTextMessage('เรียกเก็บเงิน', B);
  assert.equal(ok.type, 'settlement_trigger');
  assert.equal(ok.notification.amount, 50);
  assert.equal(ok.notification.debtorName, 'ปิ๊ก');
});

test('billed amount equals the summary amount', async () => {
  await setup();
  await handleTextMessage('ค่าข้าว 100', A);
  await handleTextMessage('ค่ากาแฟ 80 ฉัน 50 แฟน 30', B);
  await handleTextMessage('ค่าทัวร์ 1000 หาร 3 คน', A);

  const summary = await handleTextMessage('สรุป', A);
  const shown = Number(summary.reply.match(/([\d.]+) บาท/)[1]);
  const billed = await handleTextMessage('ใช่', A);
  assert.equal(billed.type, 'settlement_trigger');
  assert.equal(billed.notification.amount, shown);
});

test('if an expense is deleted after the summary, billing is refused (amount changed)', async () => {
  await setup();
  await handleTextMessage('ค่าข้าว 100', A);
  await handleTextMessage('ค่าโรงแรม 1000', A);
  await handleTextMessage('สรุป', A);

  const hotel = (await getExpenses()).find((e) => e.description === 'ค่าโรงแรม');
  await deleteExpenseById(hotel.id);

  const r = await handleTextMessage('ใช่', A);
  assert.equal(r.type, 'error');
  assert.ok(r.reply.includes('ยอดเปลี่ยน'), r.reply);
  assert.ok(r.reply.includes('สรุป ใหม่'));
});

test('an expense added after the bill is agreed is NOT cleared by รับแล้ว', async () => {
  await setup();
  await handleTextMessage('ค่าข้าว 100', A);
  await handleTextMessage('สรุป', A);
  await handleTextMessage('ใช่', A);
  await handleTextMessage('จ่ายแล้ว', B);

  await handleTextMessage('ค่าน้ำ 40', A); // เพิ่มหลังตกลงยอด
  const received = await handleTextMessage('รับแล้ว', A);
  assert.ok(received.reply.includes('50.00'));

  const left = (await getExpenses()).filter((e) => !e.isCleared).map((e) => e.description);
  assert.deepEqual(left, ['ค่าน้ำ']);

  const next = await handleTextMessage('สรุป', A);
  assert.ok(next.reply.includes('แจม ต้องจ่ายให้ ปิ๊ก 20.00'), next.reply);
});

test('trip summary counts only open items and says how many were already cleared', async () => {
  await setup();
  await handleTextMessage('สร้างทริป หัวหิน', A);
  await handleTextMessage('ค่าโรงแรม 1200 #หัวหิน', A);

  await handleTextMessage('สรุปทริป หัวหิน', A);
  await handleTextMessage('ใช่', A);
  await handleTextMessage('จ่ายแล้ว', B);
  await handleTextMessage('รับแล้ว', A);

  await handleTextMessage('ค่าอาหาร 300 #หัวหิน', B);
  const again = await handleTextMessage('สรุปทริป หัวหิน', A);
  assert.ok(again.reply.includes('รายการทั้งหมด: 300 บาท (1 รายการ) (เคลียร์แล้ว 1 รายการ ไม่รวม)'), again.reply);
  assert.ok(again.reply.includes('ปิ๊ก ต้องจ่ายคืน แจม 150.00'), again.reply);
  assert.ok(!again.reply.includes('ค่าโรงแรม'));

  await handleTextMessage('ใช่', B);
  await handleTextMessage('จ่ายแล้ว', A);
  await handleTextMessage('รับแล้ว', B);
  const done = await handleTextMessage('สรุปทริป หัวหิน', A);
  assert.ok(done.reply.includes('เคลียร์ยอดครบแล้ว'), done.reply);
});
