const test = require('node:test');
const assert = require('node:assert/strict');
const { calculateBalances } = require('../src/utils/balance');

test('calculates a simple half-split summary', () => {
  const summary = calculateBalances([
    { paidBy: 'userA', amount: 500, splitMode: 'half' },
    { paidBy: 'userB', amount: 300, splitMode: 'half' },
  ], ['userA', 'userB']);

  assert.equal(summary.userA, 100);
  assert.equal(summary.userB, -100);
});

test('keeps personal expenses out of shared balance', () => {
  const summary = calculateBalances([
    { paidBy: 'userA', amount: 800, splitMode: 'none' },
    { paidBy: 'userB', amount: 200, splitMode: 'half' },
  ], ['userA', 'userB']);

  assert.equal(summary.userA, -100);
  assert.equal(summary.userB, 100);
});
