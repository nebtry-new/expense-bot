const test = require('node:test');
const assert = require('node:assert/strict');
const { handleTextMessage } = require('../src/handlers/text');
const { resetData, registerUser, getExpenses } = require('../src/services/db');
const { __setInterpreter, validateInterpretation, numbersInText } = require('../src/services/nl-intent');
const { clearAllState } = require('../src/handlers/state');

const u1 = { lineUserId: 'u1' };

async function setup() {
  await resetData();
  clearAllState();
  await registerUser({ lineUserId: 'u1', displayName: 'A' });
  await registerUser({ lineUserId: 'u2', displayName: 'B' });
}

function stub(result) {
  const calls = [];
  __setInterpreter(async (text, ctx) => { calls.push({ text, ctx }); return typeof result === 'function' ? result(text) : result; });
  return calls;
}

test.afterEach(() => __setInterpreter(null));

test('natural sentence → partner pays fully (custom my_share 0)', async () => {
  await setup();
  stub({ intent: 'add_expense', confidence: 0.9, expenses: [
    { description: 'ค่าข้าว', amount: 450, payer: 'me', split: 'custom', my_share: 0, partner_share: 450 },
  ] });

  const r = await handleTextMessage('เมื่อวานเลี้ยงข้าวแฟน 450 บาท', u1);
  assert.equal(r.type, 'expense_nl');
  assert.ok(r.reply.includes('ลบรายการ'));

  const [saved] = await getExpenses();
  assert.equal(saved.splitMode, 'custom');
  assert.equal(saved.amount, 450);
  assert.equal(Object.values(saved.customAmounts).reduce((a, b) => a + b, 0), 450);
});

test('payer=partner is recorded under the partner', async () => {
  await setup();
  stub({ intent: 'add_expense', confidence: 0.9, expenses: [
    { description: 'ค่าที่พัก', amount: 1200, payer: 'partner', split: 'half' },
  ] });

  const r = await handleTextMessage('แฟนออกค่าที่พัก 1200', u1);
  assert.equal(r.type, 'expense_nl');
  const [saved] = await getExpenses();
  assert.equal(saved.paidByDisplayName, 'B');
});

test('amount written as "1.5k" / "สองพัน" style digits is accepted', async () => {
  assert.ok(numbersInText('ค่าน้ำมัน 1.5k').has(1500));
  assert.ok(numbersInText('ค่าห้อง 2 พัน').has(2000));
  assert.ok(numbersInText('ค่าห้อง 1,200').has(1200));
});

test('hallucinated amount (not in text) is rejected and nothing is saved', async () => {
  await setup();
  stub({ intent: 'add_expense', confidence: 0.95, expenses: [
    { description: 'ค่าข้าว', amount: 999, payer: 'me', split: 'half' },
  ] });

  const r = await handleTextMessage('ออกค่าข้าวให้แฟน 450', u1);
  assert.equal(r.type, 'error');
  assert.equal((await getExpenses()).length, 0);
});

test('custom shares that do not add up are rejected', () => {
  const res = validateInterpretation({ intent: 'add_expense', confidence: 1, expenses: [
    { description: 'x', amount: 100, payer: 'me', split: 'custom', my_share: 30, partner_share: 30 },
  ] }, 'x 100');
  assert.equal(res.ok, false);
  assert.equal(res.reason, 'custom_sum_mismatch');
});

test('unknown intent / low confidence / API error fall back to the old noop reply', async () => {
  await setup();

  stub({ intent: 'unknown', confidence: 1, expenses: [] });
  assert.equal((await handleTextMessage('สวัสดีจ้า', u1)).type, 'noop');

  stub({ intent: 'add_expense', confidence: 0.2, expenses: [{ description: 'x', amount: 5, payer: 'me', split: 'half' }] });
  assert.equal((await handleTextMessage('กินข้าวห้าบาท', u1)).type, 'noop');

  __setInterpreter(async () => { throw new Error('boom'); });
  assert.equal((await handleTextMessage('เลี้ยงข้าวแฟน สี่ร้อย', u1)).type, 'noop');

  assert.equal((await getExpenses()).length, 0);
});

test('unknown trip name is rejected without saving', async () => {
  await setup();
  stub({ intent: 'add_expense', confidence: 0.9, expenses: [
    { description: 'ค่าโรงแรม', amount: 1000, payer: 'me', split: 'half', trip_name: 'ทริปผี' },
  ] });
  const r = await handleTextMessage('ออกค่าโรงแรม 1000 ทริปผี', u1);
  assert.equal(r.type, 'error');
  assert.equal((await getExpenses()).length, 0);
});

test('messages the old parser understands never reach the interpreter', async () => {
  await setup();
  const calls = stub({ intent: 'unknown', confidence: 1, expenses: [] });
  const r = await handleTextMessage('ค่าอาหาร 350', u1);
  assert.equal(r.type, 'expense');
  assert.equal(calls.length, 0);
});
