const test = require('node:test');
const assert = require('node:assert/strict');
const { handleTextMessage } = require('../src/handlers/text');
const { resetData, registerUser, getExpenses } = require('../src/services/db');
const { __setInterpreter, __resetRateLimit, validateInterpretation, numbersInText } = require('../src/services/nl-intent');
const { clearAllState } = require('../src/handlers/state');

const u1 = { lineUserId: 'u1' };

async function setup() {
  __resetRateLimit();
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

test('unknown intent / low confidence → old noop reply; API error → explicit retry message', async () => {
  await setup();

  stub({ intent: 'unknown', confidence: 1, expenses: [] });
  assert.equal((await handleTextMessage('สวัสดีจ้า', u1)).type, 'noop');

  stub({ intent: 'add_expense', confidence: 0.2, expenses: [{ description: 'x', amount: 5, payer: 'me', split: 'half' }] });
  assert.equal((await handleTextMessage('กินข้าวห้าบาท', u1)).type, 'noop');

  __setInterpreter(async () => { throw new Error('boom'); });
  const apiDown = await handleTextMessage('เลี้ยงข้าวแฟน สี่ร้อย', u1);
  assert.equal(apiDown.type, 'error'); // tell the user, don't silently drop or mis-save
  assert.ok(apiDown.reply.includes('ลองใหม่'));

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

test('"ยืม" sentences bypass the old half-split parser (resolved in code, no model call)', async () => {
  await setup();
  const calls = stub({ intent: 'add_expense', confidence: 0.9, expenses: [
    { description: 'ยืมเงิน', amount: 500, payer: 'partner', split: 'custom', my_share: 500, partner_share: 0 },
  ] });

  const r = await handleTextMessage('ยืมเงิน 500', u1);
  assert.equal(calls.length, 0);
  assert.equal(r.type, 'expense_nl');
  assert.ok(r.reply.includes('A ต้องคืน B เต็มจำนวน 500'), r.reply);

  const [saved] = await getExpenses();
  assert.equal(saved.paidByDisplayName, 'B');
  assert.equal(saved.splitMode, 'custom');
});

test('partner borrowing from me: "แฟนยืม 300" → partner owes me in full', async () => {
  await setup();
  stub({ intent: 'add_expense', confidence: 0.9, expenses: [
    { description: 'แฟนยืมเงิน', amount: 300, payer: 'me', split: 'custom', my_share: 0, partner_share: 300 },
  ] });
  const r = await handleTextMessage('แฟนยืม 300', u1);
  assert.ok(r.reply.includes('B ต้องคืน A เต็มจำนวน 300'), r.reply);
});

const { detectBorrower } = require('../src/services/nl-intent');

test('detectBorrower: "X ยืม Y" → X is the borrower (names from the users)', () => {
  const names = { senderName: 'ปิ๊ก', partnerName: 'แจม' };
  assert.equal(detectBorrower('ปิ๊กยืมแจม 500 ไปทำบุญ', names), 'me');
  assert.equal(detectBorrower('แจมยืมปิ๊ก 500', names), 'partner');
  assert.equal(detectBorrower('ปิ๊ก ยืมตังแจม 500', names), 'me');
  assert.equal(detectBorrower('แจมให้ปิ๊กยืม 500', names), 'me');
  assert.equal(detectBorrower('ปิ๊กให้แจมยืม 500', names), 'partner');
  assert.equal(detectBorrower('แฟนยืม 300', names), 'partner');
  assert.equal(detectBorrower('ยืมแฟน 300', names), 'me');
  assert.equal(detectBorrower('ยืมเงิน 500', names), null);
});

test('loan direction is enforced in code even if the model gets it backwards', async () => {
  await setup(); // users: A (u1, sender) and B
  // model wrongly says: B owes A (payer=me), for "A ยืม B 500"
  stub({ intent: 'add_expense', confidence: 0.9, expenses: [
    { description: 'ยืมเงินไปทำบุญ', amount: 500, payer: 'me', split: 'custom', my_share: 0, partner_share: 500 },
  ] });

  const r = await handleTextMessage('AยืมB 500 ไปทำบุญ', u1);
  assert.equal(r.type, 'expense_nl');
  assert.ok(r.reply.includes('A ต้องคืน B เต็มจำนวน 500'), r.reply);
  const [saved] = await getExpenses();
  assert.equal(saved.paidByDisplayName, 'B');
});

const { parseLoanMessage } = require('../src/services/nl-intent');

test('parseLoanMessage: direction and amount are decided in code', () => {
  const n = { senderName: 'ปิ๊ก', partnerName: 'แจม' };

  const a = parseLoanMessage('แจมให้ยืม 500', n); // แจม lends → ปิ๊ก (sender) owes
  assert.equal(a.payer, 'partner');
  assert.equal(a.myShare, 500);
  assert.equal(a.partnerShare, 0);

  const b = parseLoanMessage('ปิ๊กยืม 500', n); // ปิ๊ก borrows from แจม
  assert.equal(b.payer, 'partner');
  assert.equal(b.myShare, 500);

  const c = parseLoanMessage('ปิ๊กยืมแจม 500 ไปทำบุญ', n);
  assert.equal(c.payer, 'partner');
  assert.equal(c.description, 'ยืมเงินไปทำบุญ');

  const d = parseLoanMessage('แจมยืม 1.5k', n); // แจม borrows → ปิ๊ก paid
  assert.equal(d.payer, 'me');
  assert.equal(d.partnerShare, 1500);

  assert.equal(parseLoanMessage('ยืม 500', n).payer, 'partner'); // default: sender borrows
  assert.equal(parseLoanMessage('ยืม 500 กับ 200', n), null);    // ambiguous → model
});

test('loan messages are saved without calling the model, and never fall back to half-split', async () => {
  await setup(); // sender A, partner B
  const calls = stub({ intent: 'unknown', confidence: 0, expenses: [] });

  const r = await handleTextMessage('Bให้ยืม 500', u1); // B lends → A owes B
  assert.equal(calls.length, 0);
  assert.equal(r.type, 'expense_nl');
  assert.ok(r.reply.includes('A ต้องคืน B เต็มจำนวน 500'), r.reply);

  const [saved] = await getExpenses();
  assert.equal(saved.paidByDisplayName, 'B');
  assert.equal(saved.splitMode, 'custom');

  // ambiguous loan the model can't resolve → error, nothing saved as half-split
  const r2 = await handleTextMessage('ยืมกับเงินเก่า 200 และ 300', u1);
  assert.equal(r2.type, 'error');
  assert.equal((await getExpenses()).length, 1);
});

test('Anthropic credit exhausted → clear error, nothing saved as half-split', async () => {
  await setup();
  __setInterpreter(async () => {
    const e = new Error('400');
    e.error = { error: { type: 'invalid_request_error', message: 'Your credit balance is too low to access the Anthropic API.' } };
    throw e;
  });

  const r = await handleTextMessage('เลี้ยงข้าวแฟน 450', u1); // cue word, old parser would save half-split
  assert.equal(r.type, 'error');
  assert.ok(r.reply.includes('เครดิต'), r.reply);
  assert.equal((await getExpenses()).length, 0);

  // plain expenses (old parser) keep working with no AI
  assert.equal((await handleTextMessage('ค่าอาหาร 350', u1)).type, 'expense');
});
