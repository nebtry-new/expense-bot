const test = require('node:test');
const assert = require('node:assert/strict');
const { handleTextMessage } = require('../src/handlers/text');
const { resetData, registerUser, getUsers } = require('../src/services/db');

test('registers a user from a text command', async () => {
  await resetData();

  const result = await handleTextMessage('ลงทะเบียน แฟน');

  assert.equal(result.type, 'register');
  assert.equal((await getUsers()).length, 1);
  assert.equal(result.reply.includes('แฟน'), true);
});

test('builds a shared summary command without personal expenses', async () => {
  await resetData();
  await registerUser({ lineUserId: 'u1', displayName: 'A' });
  await registerUser({ lineUserId: 'u2', displayName: 'B' });

  const result = await handleTextMessage('ค่าอาหาร 500', { lineUserId: 'u1' });
  assert.equal(result.type, 'expense');

  const summary = await handleTextMessage('สรุป');
  assert.equal(summary.type, 'summary');
  assert.equal(summary.reply.includes('B'), true);
  assert.equal(summary.reply.includes('A'), true);
});

test('renames the current user without changing their stable user id', async () => {
  await resetData();
  const user = await registerUser({ lineUserId: 'u1', displayName: 'A' });

  const renamed = await handleTextMessage('เปลี่ยนชื่อ แอล', { lineUserId: 'u1' });

  assert.equal(renamed.type, 'rename_user');
  assert.equal(renamed.user.displayName, 'แอล');
  assert.equal(renamed.user.id, user.id);
  assert.equal((await getUsers())[0].displayName, 'แอล');
});

test('states clearly who owes whom in the settlement message', async () => {
  await resetData();
  await registerUser({ lineUserId: 'u1', displayName: 'A' });
  await registerUser({ lineUserId: 'u2', displayName: 'B' });

  await handleTextMessage('ค่าอาหาร 500', { lineUserId: 'u1' });
  const summary = await handleTextMessage('สรุป');

  assert.equal(summary.reply.includes('B ต้องจ่ายให้ A'), true);
});

test('asks to collect payment and includes debtor notification data after summary', async () => {
  await resetData();
  await registerUser({ lineUserId: 'u1', displayName: 'A' });
  await registerUser({ lineUserId: 'u2', displayName: 'B' });

  await handleTextMessage('ค่าอาหาร 500', { lineUserId: 'u1' });
  const summary = await handleTextMessage('สรุป');

  assert.match(summary.reply, /เรียกเก็บเงินเลยไหม|อยากเรียกเก็บเงินเลยไหม/i);
  assert.equal(summary.notification?.debtorName, 'B');
  assert.equal(summary.notification?.creditorName, 'A');
  assert.equal(summary.notification?.amount, 250);
});

test('keeps balance calculations stable even if display names change later', async () => {
  await resetData();
  const userA = await registerUser({ lineUserId: 'u1', displayName: 'A' });
  const userB = await registerUser({ lineUserId: 'u2', displayName: 'B' });

  await handleTextMessage('ค่าอาหาร 500', { lineUserId: 'u1' });

  const renamedUsers = [
    { ...userA, displayName: 'Alpha' },
    { ...userB, displayName: 'Beta' },
  ];

  const balanceMap = require('../src/utils/balance').calculateBalances(await require('../src/services/db').getExpenses(), renamedUsers);

  assert.equal(balanceMap[userA.id], 250);
  assert.equal(balanceMap[userB.id], -250);
  assert.equal(Object.keys(balanceMap).length, 2);
});

test('rejects a third registered user', async () => {
  await resetData();
  await registerUser({ lineUserId: 'u1', displayName: 'A' });
  await registerUser({ lineUserId: 'u2', displayName: 'B' });

  const result = await handleTextMessage('ลงทะเบียน C', { lineUserId: 'u3' });

  assert.equal(result.type, 'error');
  assert.match(result.reply, /2 คน/i);
  assert.equal((await getUsers()).length, 2);
});

test('reset-all creates a confirmation prompt and reset-confirm clears the system', async () => {
  await resetData();
  await registerUser({ lineUserId: 'u1', displayName: 'A' });
  await registerUser({ lineUserId: 'u2', displayName: 'B' });

  const prompt = await handleTextMessage('reset-all');
  assert.equal(prompt.type, 'reset_prompt');
  assert.match(prompt.reply, /reset-confirm/i);

  const result = await handleTextMessage('reset-confirm');
  assert.equal(result.type, 'reset_confirm');
  assert.equal((await getUsers()).length, 0);
});

test('terminate and restore user updates active membership state', async () => {
  await resetData();
  await registerUser({ lineUserId: 'u1', displayName: 'A' });
  await registerUser({ lineUserId: 'u2', displayName: 'B' });

  const terminated = await handleTextMessage('terminate user A');
  assert.equal(terminated.type, 'terminate_user');
  assert.equal((await getUsers()).length, 1);

  const restored = await handleTextMessage('restore user A');
  assert.equal(restored.type, 'restore_user');
  assert.equal((await getUsers()).length, 2);
});
