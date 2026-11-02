const test = require('node:test');
const assert = require('node:assert/strict');
const cases = require('./golden/nl-sentences.json');
const { runCase } = require('../scripts/golden-runner');

// ประโยคที่ตัดสินด้วยโค้ดล้วน (ไม่เรียกโมเดล) — ประโยคที่ต้องใช้โมเดลอยู่ใน `npm run eval:nl`
for (const c of cases.filter((x) => !x.needsModel)) {
  test(`golden: ${c.name || c.text} ← "${c.text}"`, async () => {
    const { failures } = await runCase(c);
    assert.deepEqual(failures, []);
  });
}

// ---------- unrecognized message log ----------
const { handleTextMessage } = require('../src/handlers/text');
const { __setInterpreter, __resetRateLimit } = require('../src/services/nl-intent');
const { resetData, registerUser } = require('../src/services/db');

test('messages the bot cannot interpret are logged and listed (greetings are not)', async () => {
  await resetData();
  __resetRateLimit();
  await registerUser({ lineUserId: 'u1', displayName: 'ปิ๊ก' });
  await registerUser({ lineUserId: 'u2', displayName: 'แจม' });
  __setInterpreter(async () => ({ intent: 'unknown', confidence: 1, expenses: [] }));

  await handleTextMessage('สวัสดี', { lineUserId: 'u1' });
  await handleTextMessage('ยืมเงินแฟนไปซื้อของนิดหน่อย', { lineUserId: 'u1' });

  const r = await handleTextMessage('ข้อความที่ไม่เข้าใจ', { lineUserId: 'u1' });
  assert.equal(r.type, 'unrecognized');
  assert.ok(r.reply.includes('ปิ๊ก: ยืมเงินแฟนไปซื้อของนิดหน่อย'), r.reply);
  assert.ok(!r.reply.includes('สวัสดี'));
  assert.ok(r.reply.includes('เหตุผล: unknown'));
  __setInterpreter(null);
});

test('AI failure on a no-number chat message stays a quiet noop', async () => {
  await resetData();
  __resetRateLimit();
  await registerUser({ lineUserId: 'u1', displayName: 'ปิ๊ก' });
  __setInterpreter(async () => { throw new Error('down'); });
  const r = await handleTextMessage('สวัสดีครับ', { lineUserId: 'u1' });
  assert.equal(r.type, 'noop');
  __setInterpreter(null);
});
