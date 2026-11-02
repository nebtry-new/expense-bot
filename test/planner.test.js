const test = require('node:test');
const assert = require('node:assert/strict');
const { handleTextMessage } = require('../src/handlers/text');
const { resetData, registerUser, addSpecialEvent, listSpecialEvents, addTodo, listOpenTodos } = require('../src/services/db');
const { clearAllState } = require('../src/handlers/state');
const { extractDueDate, extractMonthDay, nextOccurrence, localToday } = require('../src/utils/planner-dates');
const { runEventReminders, runTodoReminders, runPlannerReminders, __setGreetingWriter } = require('../src/services/planner-reminders');

const u1 = { lineUserId: 'u1' };
const u2 = { lineUserId: 'u2' };

async function setup() {
  await resetData();
  clearAllState();
  __setGreetingWriter(async () => null);
  await registerUser({ lineUserId: 'u1', displayName: 'A' });
  await registerUser({ lineUserId: 'u2', displayName: 'B' });
}

// จันทร์ 2 พ.ย. 2026 เวลาไทย 10:00 (หลังเวลาเตือน 09:00)
const NOW = new Date('2026-11-02T03:00:00Z');
const EARLY = new Date('2026-11-02T01:00:00Z'); // 08:00 ไทย

function recorder(failFor = []) {
  const sent = [];
  const fn = async (to, text) => {
    if (failFor.includes(to)) return false;
    sent.push({ to, text });
    return true;
  };
  return { sent, fn };
}

// ---------- วันที่ ----------

test('extractDueDate: วลีวันแบบไทย คิดตามปฏิทินไทย', () => {
  const due = (t) => extractDueDate(t, NOW);
  assert.deepEqual(due('จองโรงแรม 25 ธ.ค.'), { text: 'จองโรงแรม', dueDate: '2026-12-25' });
  assert.deepEqual(due('ซื้อนม พรุ่งนี้'), { text: 'ซื้อนม', dueDate: '2026-11-03' });
  assert.deepEqual(due('ซื้อของ อีก 3 วัน'), { text: 'ซื้อของ', dueDate: '2026-11-05' });
  assert.deepEqual(due('โทรหาแม่ วันจันทร์'), { text: 'โทรหาแม่', dueDate: '2026-11-09' }); // วันนี้เป็นจันทร์ → จันทร์ถัดไป
  assert.deepEqual(due('ส่งงาน วันศุกร์หน้า'), { text: 'ส่งงาน', dueDate: '2026-11-13' });
  assert.deepEqual(due('จ่ายค่าไฟ ภายใน 5/11'), { text: 'จ่ายค่าไฟ', dueDate: '2026-11-05' });
  assert.deepEqual(due('ตรวจรถ 3 ม.ค. 2570'), { text: 'ตรวจรถ', dueDate: '2027-01-03' }); // พ.ศ. → ค.ศ.
  assert.deepEqual(due('ล้างแอร์'), { text: 'ล้างแอร์', dueDate: null });
  assert.equal(due('x 31 ก.พ.').error, 'bad_date');
  assert.equal(due('เก็บของ 1 พ.ย. 2569').error, 'past');
});

test('extractMonthDay + nextOccurrence: 29 ก.พ. ปีไม่มีวัน → 28 ก.พ.', () => {
  assert.deepEqual(extractMonthDay('วันเกิดแฟน 14 มี.ค. 2540'), { day: 14, month: 3, year: 1997, text: 'วันเกิดแฟน' });
  assert.equal(extractMonthDay('ไม่มีวัน'), null);
  assert.equal(extractMonthDay('x 30 ก.พ.').error, 'bad_date');
  const today = localToday(NOW);
  assert.deepEqual(nextOccurrence(2, 29, today), { y: 2027, m: 2, d: 28 });
  assert.deepEqual(nextOccurrence(11, 2, today), { y: 2026, m: 11, d: 2 }); // วันนี้นับ
  assert.deepEqual(nextOccurrence(11, 1, today), { y: 2027, m: 11, d: 1 });
});

// ---------- วันสำคัญ (คำสั่ง) ----------

test('เพิ่มวันสำคัญ / วันสำคัญ / ลบวันสำคัญ', async () => {
  await setup();
  const added = await handleTextMessage('เพิ่มวันสำคัญ วันเกิดแฟน 14 มี.ค. 2540', u1);
  assert.equal(added.type, 'event_added');
  assert.ok(added.reply.includes('ทุกปี') && added.reply.includes('วันเกิดแฟน'), added.reply);
  await handleTextMessage('เพิ่มวันสำคัญ ครบรอบ 5/8', u2);

  const events = await listSpecialEvents();
  assert.deepEqual(events.map((e) => e.kind).sort(), ['anniversary', 'birthday']);
  assert.equal(events.find((e) => e.kind === 'birthday').year, 1997);

  const list = await handleTextMessage('วันสำคัญ', u1);
  assert.equal(list.type, 'events');
  assert.ok(list.reply.includes('วันเกิดแฟน') && list.reply.includes('ครบรอบ'));
  assert.equal(list.quickReplies.length, 2);

  const del = await handleTextMessage('ลบวันสำคัญ 1', u1);
  assert.equal(del.type, 'event_deleted');
  assert.equal((await listSpecialEvents()).length, 1);
});

test('เพิ่มวันสำคัญ: ไม่มีวัน / ไม่มีชื่อ / วันที่ผิด / ลบโดยไม่มีลิสต์', async () => {
  await setup();
  assert.equal((await handleTextMessage('เพิ่มวันสำคัญ วันเกิดแฟน', u1)).type, 'error');
  assert.equal((await handleTextMessage('เพิ่มวันสำคัญ 14 มี.ค.', u1)).type, 'error');
  assert.equal((await handleTextMessage('เพิ่มวันสำคัญ ทดสอบ 31 ก.พ.', u1)).type, 'error');
  assert.equal((await listSpecialEvents()).length, 0);
  assert.equal((await handleTextMessage('ลบวันสำคัญ 1', u1)).type, 'noop');
});

// ---------- To-Do (คำสั่ง) ----------

test('To-Do ร่วมกัน: เพิ่ม ดู (ใกล้กำหนดก่อน) แฟนทำเสร็จให้ได้ และกดซ้ำไม่ซ้ำ', async () => {
  await setup();
  assert.equal((await handleTextMessage('เพิ่มงาน ล้างแอร์', u1)).type, 'todo_added');
  assert.equal((await handleTextMessage('เพิ่มงาน จองโรงแรม 25 ธ.ค. 2099', u1)).type, 'todo_added');
  const withDue = await handleTextMessage('เพิ่มงาน ซื้อนม พรุ่งนี้', u2);
  assert.ok(withDue.reply.includes('พรุ่งนี้'), withDue.reply);

  const list = await handleTextMessage('งาน', u1);
  const order = list.reply.split('\n').filter((l) => /^\d+\./.test(l));
  assert.ok(order[0].includes('ซื้อนม') && order[0].includes('B เพิ่ม'), order.join('|')); // มีกำหนดก่อน + กำกับคนเพิ่ม
  assert.ok(order[order.length - 1].includes('ล้างแอร์'));

  const done = await handleTextMessage('เสร็จ 1', u1); // u1 ทำงานที่ u2 เพิ่มได้
  assert.equal(done.type, 'todo_done');
  assert.ok(done.reply.includes('ซื้อนม'));
  assert.equal((await listOpenTodos()).length, 2);
  // หลังทำเสร็จบอตแสดงลิสต์ใหม่ (เลขอ้างอิงลิสต์ที่เพิ่งเห็น) — ไม่ทำรายการที่เสร็จไปแล้วซ้ำ
  assert.ok(!done.reply.split('\n\n').slice(1).join('').includes('ซื้อนม'), done.reply);
  assert.ok(done.reply.includes('1. จองโรงแรม'), done.reply);
});

test('เสร็จหลายข้อ / ลบงาน / เลขเกิน / งานที่อีกคนทำเสร็จไปแล้วระหว่างนั้น', async () => {
  await setup();
  for (const t of ['ก', 'ข', 'ค', 'ง']) await handleTextMessage(`เพิ่มงาน ${t}`, u1);
  await handleTextMessage('งาน', u1);
  assert.equal((await handleTextMessage('เสร็จ 9', u1)).type, 'error');

  const multi = await handleTextMessage('เสร็จ 1 3', u1);
  assert.ok(multi.reply.includes('2 งาน'), multi.reply);
  assert.equal((await listOpenTodos()).length, 2);

  await handleTextMessage('งาน', u1);
  await handleTextMessage('งาน', u2);
  await handleTextMessage('เสร็จ 1', u2); // u2 ทำข้อ 1 ไปก่อน
  const stale = await handleTextMessage('เสร็จ 1', u1); // ลิสต์เก่าของ u1 ยังชี้งานเดิม
  assert.ok(stale.reply.includes('ถูกทำเสร็จหรือลบไปแล้ว'), stale.reply);
  assert.equal((await listOpenTodos()).length, 1);

  await handleTextMessage('งาน', u1);
  const del = await handleTextMessage('ลบงาน 1', u1);
  assert.equal(del.type, 'todo_deleted');
  assert.equal((await listOpenTodos()).length, 0);
});

test('เพิ่มงาน: วันที่ผิด/ผ่านไปแล้ว/ไม่มีข้อความ ไม่บันทึก', async () => {
  await setup();
  assert.equal((await handleTextMessage('เพิ่มงาน ทดสอบ 31 ก.พ.', u1)).type, 'error');
  assert.equal((await handleTextMessage('เพิ่มงาน ทดสอบ 1 ม.ค. 2020', u1)).type, 'error');
  assert.equal((await handleTextMessage('เพิ่มงาน พรุ่งนี้', u1)).type, 'error');
  assert.equal((await listOpenTodos()).length, 0);
});

// ---------- ตัวส่งเตือน ----------

test('เตือนวันสำคัญ: 7 วัน / 1 วัน / วันจริง ส่งให้ทั้งคู่ และไม่ส่งซ้ำ', async () => {
  await setup();
  await addSpecialEvent({ title: 'ครบรอบ', month: 11, day: 9, year: 2020, kind: 'anniversary' }); // อีก 7 วัน
  await addSpecialEvent({ title: 'วันเกิดแฟน', month: 11, day: 3, kind: 'birthday' }); // พรุ่งนี้
  await addSpecialEvent({ title: 'วาเลนไทน์', month: 11, day: 2 }); // วันนี้
  await addSpecialEvent({ title: 'ไกลๆ', month: 12, day: 25 });

  const r = recorder();
  assert.equal((await runEventReminders(r.fn, NOW)).sent, 3);
  assert.equal(r.sent.length, 6); // 3 เหตุการณ์ × 2 คน
  assert.deepEqual([...new Set(r.sent.map((s) => s.to))].sort(), ['u1', 'u2']);
  const texts = r.sent.map((s) => s.text).join('\n');
  assert.ok(texts.includes('อีก 7 วัน') && texts.includes('ครบ 6 ปี'), texts);
  assert.ok(texts.includes('พรุ่งนี้') && texts.includes('วันนี้'));
  assert.ok(!texts.includes('ไกลๆ'));

  assert.equal((await runEventReminders(r.fn, NOW)).sent, 0); // รันซ้ำ ไม่ส่งซ้ำ
  assert.equal(r.sent.length, 6);
});

test('เตือนวันสำคัญ: ก่อนเวลา 09:00 ไม่ส่ง, ส่งไม่สำเร็จไม่นับ รอบหน้าลองใหม่', async () => {
  await setup();
  await addSpecialEvent({ title: 'วันนี้จ้า', month: 11, day: 2 });

  const early = recorder();
  assert.equal((await runEventReminders(early.fn, EARLY)).sent, 0);
  assert.equal(early.sent.length, 0);

  const down = recorder(['u1', 'u2']);
  assert.equal((await runEventReminders(down.fn, NOW)).sent, 0);
  const up = recorder();
  assert.equal((await runEventReminders(up.fn, NOW)).sent, 1);
});

test('ข้อความวันจริง: ใช้ข้อความจากโมเดล และถ้าโมเดลล้ม/ว่าง ใช้ข้อความสำเร็จรูป (ยังเตือนเสมอ)', async () => {
  await setup();
  await addSpecialEvent({ title: 'วันเกิดแฟน', month: 11, day: 2, kind: 'birthday' });

  __setGreetingWriter(async () => 'สุขสันต์วันเกิดคนเก่งของเรา');
  let r = recorder();
  await runEventReminders(r.fn, NOW);
  assert.ok(r.sent[0].text.includes('สุขสันต์วันเกิดคนเก่งของเรา'));

  await setup();
  await addSpecialEvent({ title: 'วันเกิดแฟน', month: 11, day: 2, kind: 'birthday' });
  __setGreetingWriter(async () => { throw new Error('credit exhausted'); });
  r = recorder();
  assert.equal((await runEventReminders(r.fn, NOW)).sent, 1);
  assert.ok(r.sent[0].text.includes('สุขสันต์วันเกิด'));
  __setGreetingWriter(null);
});

test('เตือน To-Do: พรุ่งนี้/วันนี้ ส่งให้ทั้งคู่, ทำเสร็จแล้วไม่เตือน, ไม่มีกำหนดไม่เตือน', async () => {
  await setup();
  await addTodo({ title: 'ส่งพรุ่งนี้', dueDate: '2026-11-03' });
  await addTodo({ title: 'ส่งวันนี้', dueDate: '2026-11-02' });
  await addTodo({ title: 'ไม่มีกำหนด' });
  await addTodo({ title: 'ไกล', dueDate: '2026-12-01' });

  const r = recorder();
  assert.equal((await runTodoReminders(r.fn, NOW)).sent, 2);
  const texts = r.sent.map((s) => s.text).join('\n');
  assert.ok(texts.includes('ส่งพรุ่งนี้') && texts.includes('ส่งวันนี้'));
  assert.ok(!texts.includes('ไม่มีกำหนด') && !texts.includes('ไกล'));
  assert.equal(r.sent.length, 4);

  assert.equal((await runTodoReminders(r.fn, NOW)).sent, 0);
});

test('เพิ่มงาน/วันสำคัญของวันนี้หลัง 09:00 ไม่เตือนย้อนหลังทันที (runPlannerReminders ไม่ throw)', async () => {
  await setup();
  const today = localToday(new Date());
  await handleTextMessage(`เพิ่มวันสำคัญ ทดสอบวันนี้ ${today.d}/${today.m}`, u1);
  await handleTextMessage('เพิ่มงาน ทดสอบวันนี้ วันนี้', u1);
  const r = recorder();
  const result = await runPlannerReminders(r.fn, new Date());
  if (today.hour >= 9) assert.deepEqual(result, { events: 0, todos: 0, gifts: 0 }); // ก่อน 09:00 ก็ไม่ส่งเช่นกัน
  assert.equal(r.sent.length, 0);
});
