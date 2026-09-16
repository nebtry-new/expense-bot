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

test('states clearly who owes whom in the settlement message', async () => {
  await resetData();
  await registerUser({ lineUserId: 'u1', displayName: 'A' });
  await registerUser({ lineUserId: 'u2', displayName: 'B' });

  await handleTextMessage('ค่าอาหาร 500', { lineUserId: 'u1' });
  const summary = await handleTextMessage('สรุป');

  assert.equal(summary.reply.includes('B ต้องจ่ายให้ A'), true);
});
