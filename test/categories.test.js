const test = require('node:test');
const assert = require('node:assert/strict');
const { resetData, registerUser, addExpense, getExpenses } = require('../src/services/db');
const { classifyByRules, resolveCategory, CATEGORY_KEYS } = require('../src/utils/categories');
const { classifyPending, __setClassifier, __resetAttempted } = require('../src/services/categorize');
const { handleTextMessage } = require('../src/handlers/text');

const u1 = { lineUserId: 'u1' };

async function setup() {
  await resetData();
  __resetAttempted();
  __setClassifier(null);
  await registerUser({ lineUserId: 'u1', displayName: 'ปิ๊ก' });
  await registerUser({ lineUserId: 'u2', displayName: 'แจม' });
}

test('classifyByRules: keyword เจาะจงมาก่อน (ค่าน้ำมัน≠ค่าน้ำ) และไม่รู้จัก = other', () => {
  const cases = {
    ค่าข้าว: 'food', ซื้อกาแฟ: 'food', ค่าน้ำมัน: 'transport', ค่าน้ำ: 'bills', ค่าไฟ: 'bills',
    ดูหนัง: 'entertainment', ค่าโรงแรม: 'travel', ซื้อเสื้อ: 'shopping', ของขวัญแฟน: 'gift', ค่ายา: 'health',
    ปิ๊กยืมแจม: 'other', '': 'other',
  };
  for (const [text, key] of Object.entries(cases)) assert.equal(classifyByRules(text), key, text);
});

test('resolveCategory: ชื่อไทย/อังกฤษ/มี emoji → key, ไม่รู้จัก → null', () => {
  assert.equal(resolveCategory('อาหาร'), 'food');
  assert.equal(resolveCategory('เดินทาง'), 'transport');
  assert.equal(resolveCategory('food'), 'food');
  assert.equal(resolveCategory('🍜 อาหาร'), 'food');
  assert.equal(resolveCategory('xyz'), null);
  assert.ok(CATEGORY_KEYS.includes('other'));
});

test('บันทึกค่าใช้จ่ายแล้วจัดหมวดอัตโนมัติด้วยกฎ (ทุกทางที่บันทึกผ่าน addExpense)', async () => {
  await setup();
  await handleTextMessage('ค่าข้าว 100', u1);
  await handleTextMessage('ค่าไฟ 800', u1);
  await handleTextMessage('ของจิปาถะ 50', u1);
  const byDesc = Object.fromEntries((await getExpenses()).map((e) => [e.description, e.category]));
  assert.deepEqual(byDesc, { ค่าข้าว: 'food', ค่าไฟ: 'bills', ของจิปาถะ: 'other' });
});

test('classifyPending: กฎก่อน แล้วโมเดลเฉพาะที่เหลือ; ตอบ key นอก whitelist/other ถูกข้าม; ไม่ถามซ้ำ', async () => {
  await setup();
  // รายการเก่าที่ยังเป็น other ทั้งที่กฎจัดได้ (เหมือนข้อมูลก่อนมีฟีเจอร์นี้)
  const a = await addExpense({ paidByUserId: 'x', description: 'ค่าข้าว', amount: 10, category: 'other' });
  const b = await addExpense({ paidByUserId: 'x', description: 'ของให้แมวส้ม', amount: 20 });
  const c = await addExpense({ paidByUserId: 'x', description: 'อะไรก็ไม่รู้', amount: 30 });

  let calls = 0;
  __setClassifier(async (descs) => {
    calls += 1;
    assert.ok(!descs.includes('ค่าข้าว')); // กฎจัดไปแล้ว ไม่ส่งให้โมเดล
    return [{ n: 1, category: 'shopping' }, { n: 2, category: 'not_a_category' }];
  });
  const r = await classifyPending();
  assert.equal(r.byRules, 1);
  assert.equal(r.classified, 2);
  const cat = Object.fromEntries((await getExpenses()).map((e) => [e.id, e.category]));
  assert.equal(cat[a.id], 'food');
  assert.equal(cat[b.id], 'shopping');
  assert.equal(cat[c.id], 'other');

  await classifyPending(); // c ถูกถามไปแล้ว ไม่ถามซ้ำ
  assert.equal(calls, 1);
});

test('classifyPending: โมเดลล้มเหลว → ไม่ error กฎยังทำงาน', async () => {
  await setup();
  await addExpense({ paidByUserId: 'x', description: 'ค่าข้าว', amount: 10, category: 'other' });
  await addExpense({ paidByUserId: 'x', description: 'อะไรก็ไม่รู้', amount: 30 });
  __setClassifier(async () => { throw new Error('boom'); });
  const r = await classifyPending();
  assert.equal(r.skipped, true);
  assert.equal(r.byRules, 1);
});
