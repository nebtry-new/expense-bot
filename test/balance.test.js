const test = require('node:test');
const assert = require('node:assert/strict');
const { calculateBalances } = require('../src/utils/balance');

test('calculates a simple half-split summary', () => {
  const summary = calculateBalances([
    { paidByUserId: 'userA', amount: 500, splitMode: 'half' },
    { paidByUserId: 'userB', amount: 300, splitMode: 'half' },
  ], ['userA', 'userB']);

  assert.equal(summary.userA, 100);
  assert.equal(summary.userB, -100);
});

test('keeps personal expenses out of shared balance', () => {
  const summary = calculateBalances([
    { paidByUserId: 'userA', amount: 800, splitMode: 'none' },
    { paidByUserId: 'userB', amount: 200, splitMode: 'half' },
  ], ['userA', 'userB']);

  assert.equal(summary.userA, -100);
  assert.equal(summary.userB, 100);
});
