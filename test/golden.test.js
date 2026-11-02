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

// ---------- nl_message_log (ไว้วิเคราะห์ใน phase ถัดไป) ----------
const { listNlMessages, getExpenses: getAllExpenses } = require('../src/services/db');

test('every message through the NL layer is logged with route/outcome and saved expense ids', async () => {
  await resetData();
  __resetRateLimit();
  await registerUser({ lineUserId: 'u1', displayName: 'ปิ๊ก' });
  await registerUser({ lineUserId: 'u2', displayName: 'แจม' });
  const u1 = { lineUserId: 'u1' };

  // 1) code route (ยืม) — no model call
  __setInterpreter(async () => { throw new Error('should not be called'); });
  await handleTextMessage('ปิ๊กยืมแจม 500', u1);

  // 2) model route, success
  __setInterpreter(async () => ({ intent: 'add_expense', confidence: 0.9, expenses: [
    { description: 'ค่าข้าว', amount: 450, payer: 'me', split: 'custom', my_share: 0, partner_share: 450 },
  ] }));
  await handleTextMessage('เมื่อวานเลี้ยงข้าวแฟน 450', u1);

  // 3) model route, failure
  __setInterpreter(async () => ({ intent: 'unknown', confidence: 1, expenses: [] }));
  await handleTextMessage('เลี้ยงข้าวแฟนเมื่อกี้ไม่รู้เท่าไหร่ 1 มื้อ', u1);

  const log = (await listNlMessages()).reverse(); // oldest first
  assert.equal(log.length, 3);

  assert.equal(log[0].route, 'code');
  assert.equal(log[0].outcome, 'saved');
  assert.equal(log[0].expense_ids.length, 1);

  assert.equal(log[1].route, 'model');
  assert.equal(log[1].outcome, 'saved');
  assert.equal(log[1].has_date, true);
  assert.equal(log[1].interpreted[0].payer, 'me');
  assert.ok(log[1].latency_ms >= 0);

  assert.equal(log[2].outcome, 'failed');
  assert.equal(log[2].reason, 'unknown');

  const savedIds = (await getAllExpenses()).map((e) => String(e.id));
  assert.ok(log[1].expense_ids.every((id) => savedIds.includes(String(id))));
  __setInterpreter(null);
});
