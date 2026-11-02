// รันประโยคตัวอย่างจาก test/golden/nl-sentences.json ผ่าน handleTextMessage แล้วตรวจรายการที่บันทึกลง DB
// ใช้ร่วมกันระหว่าง npm test (ไม่เรียกโมเดล) และ npm run eval:nl (เรียกโมเดลจริง)
const { handleTextMessage } = require('../src/handlers/text');
const { resetData, registerUser, getExpenses, getUsers } = require('../src/services/db');
const { __setInterpreter, __resetRateLimit } = require('../src/services/nl-intent');
const { clearAllState } = require('../src/handlers/state');

const SENDERS = { ปิ๊ก: { lineUserId: 'u1' }, แจม: { lineUserId: 'u2' } };
const DAY_MS = 24 * 60 * 60 * 1000;

async function runCase(testCase, { useModel = false } = {}) {
  await resetData();
  clearAllState();
  __resetRateLimit();
  await registerUser({ lineUserId: 'u1', displayName: 'ปิ๊ก' });
  await registerUser({ lineUserId: 'u2', displayName: 'แจม' });
  const users = await getUsers();
  const nameById = Object.fromEntries(users.map((u) => [String(u.id), u.displayName]));

  if (!useModel) {
    __setInterpreter(async () => { throw new Error('model disabled in unit mode'); });
  } else {
    __setInterpreter(null);
  }

  const startedAt = Date.now();
  const reply = await handleTextMessage(testCase.text, SENDERS[testCase.from || 'ปิ๊ก']);
  const saved = await getExpenses();
  const failures = [];
  const expected = testCase.expect.expenses || [];

  if (testCase.expect.none && saved.length) failures.push(`ควรไม่บันทึกอะไร แต่บันทึก ${saved.length} รายการ`);
  if (!testCase.expect.none && saved.length !== expected.length) {
    failures.push(`ควรบันทึก ${expected.length} รายการ แต่ได้ ${saved.length} (ตอบ: ${String(reply.reply).split('\n')[0]})`);
  }

  expected.forEach((want, i) => {
    const got = saved[i];
    if (!got) return;
    const tag = `รายการ ${i + 1}`;
    if (want.amount !== undefined && Number(got.amount) !== want.amount) failures.push(`${tag}: ยอด ${got.amount} ≠ ${want.amount}`);
    if (want.split && got.splitMode !== want.split) failures.push(`${tag}: split ${got.splitMode} ≠ ${want.split}`);
    if (want.payer && nameById[String(got.paidByUserId)] !== want.payer && got.paidByDisplayName !== want.payer) {
      failures.push(`${tag}: คนจ่าย ${got.paidByDisplayName ?? nameById[String(got.paidByUserId)]} ≠ ${want.payer}`);
    }
    if (want.shares) {
      for (const [name, amount] of Object.entries(want.shares)) {
        const userId = users.find((u) => u.displayName === name)?.id;
        const share = Number(got.customAmounts?.[String(userId)] ?? NaN);
        if (share !== amount) failures.push(`${tag}: ส่วนของ ${name} = ${share} ≠ ${amount}`);
      }
    }
    if (want.descriptionIncludes && !String(got.description).includes(want.descriptionIncludes)) {
      failures.push(`${tag}: ชื่อรายการ "${got.description}" ไม่มี "${want.descriptionIncludes}"`);
    }
    if (want.daysAgo !== undefined) {
      const diffDays = (startedAt - new Date(got.createdAt).getTime()) / DAY_MS;
      if (Math.abs(diffDays - want.daysAgo) > 0.01) failures.push(`${tag}: ย้อนหลัง ${diffDays.toFixed(2)} วัน ≠ ${want.daysAgo}`);
    }
  });

  __setInterpreter(null);
  return { failures, reply: reply.reply };
}

module.exports = { runCase };
