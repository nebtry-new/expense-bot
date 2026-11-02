const test = require('node:test');
const assert = require('node:assert/strict');
const { handleTextMessage } = require('../src/handlers/text');
const { resetData, registerUser, getExpenses, getTrips, listPendingNotifications } = require('../src/services/db');
const { __setInterpreter, __resetRateLimit } = require('../src/services/nl-intent');
const { answerQuestion, periodRange } = require('../src/services/queries');
const { clearAllState, nlCommandState } = require('../src/handlers/state');

const u1 = { lineUserId: 'u1' };
const u2 = { lineUserId: 'u2' };

async function setup() {
  __resetRateLimit();
  await resetData();
  clearAllState();
  await registerUser({ lineUserId: 'u1', displayName: 'ปิ๊ก' });
  await registerUser({ lineUserId: 'u2', displayName: 'แจม' });
}

const stub = (result) => __setInterpreter(async () => result);
const command = (name, extra = {}) => ({ intent: 'command', confidence: 0.9, command: { name, ...extra } });
test.afterEach(() => __setInterpreter(null));

// ---------- Phase 2: commands ----------

test('command intent: read-only commands run directly', async () => {
  await setup();
  await handleTextMessage('ค่าข้าว 100', u1);
  stub(command('summary'));
  const r = await handleTextMessage('ขอดูหน่อยว่าตอนนี้ค้างกันเท่าไหร่', u1);
  assert.equal(r.type, 'summary');
  assert.ok(r.reply.includes('50.00'));
});

test('command intent: money/status commands need an explicit "ใช่" and cancel cleanly', async () => {
  await setup();
  stub(command('payment_received'));
  const ask = await handleTextMessage('ได้เงินจากแจมแล้วนะ', u1);
  assert.equal(ask.type, 'nl_confirm');
  assert.ok(ask.reply.includes('เคลียร์ยอด'));
  assert.ok(nlCommandState.pendingByUser.u1);

  // ยกเลิก → ไม่ทำอะไร
  const cancel = await handleTextMessage('ยกเลิก', u1);
  assert.equal(cancel.reply, 'ยกเลิกแล้ว');
  assert.equal(nlCommandState.pendingByUser.u1, undefined);

  // ยืนยัน → รันคำสั่งเดิม (ไม่มีรายการรอยืนยันจริง ก็ตอบตามเดิม)
  stub(command('payment_received'));
  await handleTextMessage('ได้เงินจากแจมแล้วนะ', u1);
  const yes = await handleTextMessage('ใช่', u1);
  assert.equal(yes.type, 'payment_confirm_missing');
});

test('command intent: unrelated next message drops the pending confirmation', async () => {
  await setup();
  stub(command('payment_sent'));
  await handleTextMessage('โอนให้แล้วนะ', u1);
  assert.ok(nlCommandState.pendingByUser.u1);

  __setInterpreter(null);
  await handleTextMessage('ค่าข้าว 100', u1);
  assert.equal(nlCommandState.pendingByUser.u1, undefined);
  const yes = await handleTextMessage('ใช่', u1);
  assert.equal(yes.type, 'noop'); // ไม่มีอะไรรออยู่ — "จ่ายแล้ว" ไม่ถูกรัน
});

test('command intent: close_trip is confirmed, then executed', async () => {
  await setup();
  await handleTextMessage('สร้างทริป หัวหิน', u1);
  stub(command('close_trip', { trip_name: 'หัวหิน' }));
  const ask = await handleTextMessage('ทริปหัวหินจบแล้ว เก็บเงินได้เลย', u1);
  assert.equal(ask.type, 'nl_confirm');
  assert.equal((await getTrips())[0].is_billable, false);

  await handleTextMessage('ใช่', u1);
  assert.equal((await getTrips())[0].is_billable, true);
});

test('command intent: missing trip name asks for it; unknown command name is rejected', async () => {
  await setup();
  stub(command('trip_summary'));
  assert.equal((await handleTextMessage('สรุปทริปให้หน่อย', u1)).type, 'error');

  stub(command('drop_database'));
  assert.equal((await handleTextMessage('ล้างข้อมูลให้หน่อย', u1)).type, 'noop');
});

// ---------- Phase 3: reminders via model ----------

test('reminder intent: scheduled from model output, validated by code', async () => {
  await setup();
  const tomorrow = new Date(Date.now() + 7 * 3600000 + 86400000).toISOString().slice(0, 10);
  stub({ intent: 'reminder', confidence: 0.9, reminder: { when_local: `${tomorrow}T15:00`, message: 'ซื้อนม', both: true } });
  const r = await handleTextMessage('พรุ่งนี้บ่ายสามอย่าลืมซื้อนมนะ ทั้งคู่เลย', u1);
  assert.equal(r.type, 'notification_set');
  const [n] = await listPendingNotifications();
  assert.equal(n.message, 'ซื้อนม');
  assert.equal(n.line_user_id, null);

  stub({ intent: 'reminder', confidence: 0.9, reminder: { when_local: '2020-01-01T09:00', message: 'เก่า' } });
  assert.equal((await handleTextMessage('เมื่อก่อนอย่าลืมเก่า', u1)).type, 'error');
  assert.equal((await listPendingNotifications()).length, 1);
});

// ---------- Phase 4: questions ----------

test('question intent: answers are computed from real data, not from the model', async () => {
  await setup();
  await handleTextMessage('ค่ากาแฟ 100', u1);
  await handleTextMessage('ค่ากาแฟ 60', u2);
  await handleTextMessage('ค่าข้าว 500', u1);

  stub({ intent: 'question', confidence: 0.9, question: { kind: 'total', period: 'this_month', keywords: ['กาแฟ'], payer: 'any' } });
  const r = await handleTextMessage('เดือนนี้กินกาแฟไปเท่าไหร่', u1);
  assert.equal(r.type, 'nl_answer');
  assert.ok(r.reply.includes('รวม 160 บาท (2 รายการ)'), r.reply);
  assert.ok(r.reply.includes('ปิ๊ก จ่ายไป 100') && r.reply.includes('แจม จ่ายไป 60'));

  stub({ intent: 'question', confidence: 0.9, question: { kind: 'balance' } });
  const bal = await handleTextMessage('ตอนนี้ใครต้องจ่ายใครอยู่', u1);
  assert.ok(bal.reply.includes('แจม ต้องจ่ายให้ ปิ๊ก'), bal.reply);
});

test('questions with numbers are never saved as expenses', async () => {
  await setup();
  stub({ intent: 'unknown', confidence: 1 });
  const r = await handleTextMessage('เดือนนี้ใช้ไป 3 ครั้งแล้วใช่ไหม', u1);
  assert.equal(r.type, 'noop');
  assert.equal((await getExpenses()).length, 0);
});

test('queries: period ranges use Thai calendar days', () => {
  const now = new Date('2026-11-02T03:00:00Z'); // Mon 2 Nov, 10:00 Thai
  const [start, end] = periodRange('this_month', now);
  assert.equal(new Date(start).toISOString(), '2026-10-31T17:00:00.000Z'); // 1 Nov 00:00 Thai
  assert.equal(new Date(end).toISOString(), '2026-11-30T17:00:00.000Z');
  const [ws] = periodRange('this_week', now);
  assert.equal(new Date(ws).toISOString(), '2026-11-01T17:00:00.000Z'); // Monday 2 Nov 00:00 Thai
  assert.equal(periodRange('all', now), null);
});

test('queries: recent, trip_total, unknown trip, bad kind', () => {
  const users = [{ id: 1, displayName: 'ปิ๊ก' }, { id: 2, displayName: 'แจม' }];
  const trips = [{ id: 't1', name: 'หัวหิน', is_billable: false }];
  const expenses = [
    { id: 'a', paidByUserId: 1, amount: 1000, description: 'โรงแรม', tripId: 't1', createdAt: '2026-11-01T05:00:00Z', splitMode: 'half' },
    { id: 'b', paidByUserId: 2, amount: 80, description: 'กาแฟ', createdAt: '2026-11-02T01:00:00Z', splitMode: 'half' },
  ];
  const now = new Date('2026-11-02T03:00:00Z');

  const trip = answerQuestion({ kind: 'trip_total', trip_name: 'หัวหิน' }, { expenses, users, trips, now });
  assert.ok(trip.reply.includes('รวม 1,000 บาท') && trip.reply.includes('แจม ต้องจ่ายให้ ปิ๊ก 500'), trip.reply);

  assert.ok(answerQuestion({ kind: 'trip_total', trip_name: 'ผี' }, { expenses, users, trips, now }).reply.includes('ไม่พบทริป'));
  assert.equal(answerQuestion({ kind: 'nope' }, { expenses, users, trips, now }).error, 'bad_kind');

  const recent = answerQuestion({ kind: 'recent', limit: 1 }, { expenses, users, trips, now });
  assert.ok(recent.reply.includes('กาแฟ 80') && !recent.reply.includes('โรงแรม'));

  const bal = answerQuestion({ kind: 'balance' }, { expenses, users, trips, now });
  assert.ok(bal.reply.includes('ทริปที่ยังไม่เรียกเก็บ') && bal.reply.includes('หัวหิน 1,000'), bal.reply);
});
