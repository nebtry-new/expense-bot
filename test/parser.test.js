const test = require('node:test');
const assert = require('node:assert/strict');
const { parseExpenseText } = require('../src/utils/parser');

test('parses a regular expense with default split', () => {
  const result = parseExpenseText('ค่าอาหาร 350');

  assert.equal(result.amount, 350);
  assert.equal(result.description, 'ค่าอาหาร');
  assert.equal(result.splitMode, 'half');
});

test('parses a per-head split and custom text', () => {
  const result = parseExpenseText('ค่าน้ำมัน 1,200 หาร 4 คน');

  assert.equal(result.amount, 1200);
  assert.equal(result.description, 'ค่าน้ำมัน');
  assert.equal(result.splitMode, 'per_head');
  assert.equal(result.numPeople, 4);
});

test('detects a private expense', () => {
  const result = parseExpenseText('ของขวัญ 800');

  assert.equal(result.splitMode, 'none');
  assert.equal(result.description, 'ของขวัญ');
});
