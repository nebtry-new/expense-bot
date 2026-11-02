const test = require('node:test');
const assert = require('node:assert/strict');
const { handleTextMessage } = require('../src/handlers/text');
const { resetData, registerUser, getExpenses, getTrips } = require('../src/services/db');
const { slipConfirmState, evRouteState, deleteConfirmState, deleteListState, clearAllState } = require('../src/handlers/state');

const u1 = { lineUserId: 'u1' };
const u2 = { lineUserId: 'u2' };

async function setup() {
  await resetData();
  clearAllState();
  await registerUser({ lineUserId: 'u1', displayName: 'A' });
  await registerUser({ lineUserId: 'u2', displayName: 'B' });
}

// ---------- stale pending flows ----------

test('unrelated message drops pending slip so a later "ใช่" does not save it', async () => {
  await setup();
  slipConfirmState.pendingByUser.u1 = { paidByUserId: 'x', paidByDisplayName: 'A', description: 'slip', amount: 999 };

  await handleTextMessage('สรุป', u1);
  assert.equal(slipConfirmState.pendingByUser.u1, undefined);

  const result = await handleTextMessage('ใช่', u1);
  assert.equal(result.type, 'noop');
  assert.equal((await getExpenses()).length, 0);
});

test('pending slip survives a valid reply', async () => {
  await setup();
  slipConfirmState.pendingByUser.u1 = { paidByUserId: 'x', paidByDisplayName: 'A', description: 'slip', amount: 999 };

  const result = await handleTextMessage('ไม่หาร', u1);
  assert.notEqual(slipConfirmState.pendingByUser.u1?.amount, 999);
  assert.ok(result);
});

test('unrelated message drops pending EV route', async () => {
  await setup();
  evRouteState.pendingByUser.u1 = { type: 'link', origin: 'a', destination: 'b' };
  await handleTextMessage('สรุป', u1);
  assert.equal(evRouteState.pendingByUser.u1, undefined);
});

test('unrelated message drops pending delete confirmation', async () => {
  await setup();
  deleteConfirmState.pendingByUser.u1 = { id: 'e1', description: 'x', amount: 1 };
  await handleTextMessage('สรุป', u1);
  assert.equal(deleteConfirmState.pendingByUser.u1, undefined);
});

// ---------- delete expense from list ----------

test('ลบรายการ lists own uncleared expenses incl. trip ones, then ลบ N + ใช่ deletes', async () => {
  await setup();
  await handleTextMessage('สร้างทริป หัวหิน', u1);
  await handleTextMessage('ค่าอาหาร 100', u1);
  await handleTextMessage('ค่าโรงแรม 1000 #หัวหิน', u1);

  const list = await handleTextMessage('ลบรายการ', u1);
  assert.equal(list.type, 'expense_delete_list');
  assert.ok(list.reply.includes('ค่าอาหาร'));
  assert.ok(list.reply.includes('ค่าโรงแรม [หัวหิน]'));

  const filtered = await handleTextMessage('ลบรายการ #หัวหิน', u1);
  assert.ok(filtered.reply.includes('ค่าโรงแรม'));
  assert.ok(!filtered.reply.includes('ค่าอาหาร'));

  const pick = await handleTextMessage('ลบ 1', u1);
  assert.equal(pick.type, 'expense_delete_prompt');
  await handleTextMessage('ใช่', u1);

  const left = await getExpenses();
  assert.equal(left.length, 1);
  assert.equal(left[0].description, 'ค่าอาหาร');
});

test('ลบ N without a list, or out of range, is rejected', async () => {
  await setup();
  assert.equal((await handleTextMessage('ลบ 1', u1)).type, 'noop');

  await handleTextMessage('ค่าอาหาร 100', u1);
  await handleTextMessage('ลบรายการ', u1);
  assert.equal((await handleTextMessage('ลบ 5', u1)).type, 'error');
});

test('ลบรายการ does not list partner expenses', async () => {
  await setup();
  await handleTextMessage('ค่าอาหาร 100', u2);
  const list = await handleTextMessage('ลบรายการ', u1);
  assert.equal(list.type, 'noop');
});

// ---------- trip billing scope ----------

test('open trip is excluded from สรุป and survives settlement; ปิดทริป brings it in', async () => {
  await setup();
  await handleTextMessage('สร้างทริป หัวหิน', u1);
  await handleTextMessage('ค่าอาหาร 100', u1);
  await handleTextMessage('ค่าโรงแรม 1000 #หัวหิน', u1);

  const summary = await handleTextMessage('สรุป', u1);
  assert.ok(summary.reply.includes('50.00'));
  assert.ok(summary.reply.includes('ทริปที่ยังไม่เรียกเก็บ'));
  assert.ok(summary.reply.includes('หัวหิน 1,000'));

  await handleTextMessage('ใช่', u1);
  await handleTextMessage('จ่ายแล้ว', u2);
  await handleTextMessage('รับแล้ว', u1);

  const afterSettle = await getExpenses();
  assert.equal(afterSettle.find((e) => e.description === 'ค่าอาหาร').isCleared, true);
  assert.ok(!afterSettle.find((e) => e.description === 'ค่าโรงแรม').isCleared);

  const closed = await handleTextMessage('ปิดทริป หัวหิน', u1);
  assert.equal(closed.type, 'trip_billable');
  assert.equal((await getTrips())[0].is_billable, true);

  const summary2 = await handleTextMessage('สรุป', u1);
  assert.ok(summary2.reply.includes('500.00'));
  assert.ok(!summary2.reply.includes('ทริปที่ยังไม่เรียกเก็บ'));
});

test('สรุปทริป settlement clears only that trip', async () => {
  await setup();
  await handleTextMessage('สร้างทริป หัวหิน', u1);
  await handleTextMessage('ค่าอาหาร 100', u1);
  await handleTextMessage('ค่าโรงแรม 1000 #หัวหิน', u1);

  await handleTextMessage('สรุปทริป หัวหิน', u1);
  await handleTextMessage('ใช่', u1);
  await handleTextMessage('จ่ายแล้ว', u2);
  await handleTextMessage('รับแล้ว', u1);

  const all = await getExpenses();
  assert.equal(all.find((e) => e.description === 'ค่าโรงแรม').isCleared, true);
  assert.ok(!all.find((e) => e.description === 'ค่าอาหาร').isCleared);
});

test('เปิดทริป takes a closed trip back out of สรุป', async () => {
  await setup();
  await handleTextMessage('สร้างทริป หัวหิน', u1);
  await handleTextMessage('ค่าโรงแรม 1000 #หัวหิน', u1);
  await handleTextMessage('ปิดทริป หัวหิน', u1);
  await handleTextMessage('เปิดทริป หัวหิน', u1);
  const summary = await handleTextMessage('สรุป', u1);
  assert.ok(summary.reply.includes('ไม่มียอดค้างจ่าย'));
});

test('ลบรายการ orders same-timestamp expenses newest-first and ลบ 1 deletes the one shown as 1', async () => {
  await setup();
  await handleTextMessage('ค่าอาหาร 100\nค่ากาแฟ 50\nค่าน้ำมัน 300', u1); // batch → timestamps can tie

  const list = await handleTextMessage('ลบรายการ', u1);
  const first = list.reply.split('\n').find((l) => l.startsWith('1.'));
  assert.ok(first.includes('ค่าน้ำมัน'), first);

  const prompt = await handleTextMessage('ลบ 1', u1);
  assert.ok(prompt.reply.includes('ค่าน้ำมัน'));
  await handleTextMessage('ใช่', u1);
  const left = (await getExpenses()).map((e) => e.description).sort();
  assert.deepEqual(left, ['ค่ากาแฟ', 'ค่าอาหาร']);
});
