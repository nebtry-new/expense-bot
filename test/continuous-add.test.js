const test = require('node:test');
const assert = require('node:assert/strict');
const { handleTextMessage } = require('../src/handlers/text');
const { resetData, registerUser, listOpenTodos } = require('../src/services/db');
const { clearAllState } = require('../src/handlers/state');
const { toReplyPayload } = require('../src/utils/quick-reply');

const u1 = { lineUserId: 'u1' };
const u2 = { lineUserId: 'u2' };

async function setup() {
  await resetData();
  clearAllState();
  await registerUser({ lineUserId: 'u1', displayName: 'ปิ๊ก' });
  await registerUser({ lineUserId: 'u2', displayName: 'แจม' });
  await handleTextMessage('สร้างทริป หัวหิน', u1);
}

const fillIns = (r) => (r.quickReplies || []).filter((q) => q.fillIn != null).map((q) => q.fillIn);

// คำสั่ง "เพิ่ม" ทุกชนิด: หลังสำเร็จต้องมีปุ่ม ➕ เปิดคีย์บอร์ดพร้อมคำสั่งตั้งต้น เป็นปุ่มแรก
const SUCCESS = [
  ['เพิ่มร้าน ราเมน', 'เพิ่มร้าน ', 'restaurant_added'],
  ['เพิ่มวันสำคัญ วันเกิดแฟน 15 ก.ค. 2536', 'เพิ่มวันสำคัญ ', 'event_added'],
  ['เพิ่มงาน ซื้อนม', 'เพิ่มงาน ', 'todo_added'],
  ['อยากได้ หูฟัง 3500', 'อยากได้ ', 'wish_added'],
  ['เพิ่มที่ ร้านต้มยำ #หัวหิน', 'เพิ่มที่ #หัวหิน ', 'place_added'],
  ['โน้ตทริป เบอร์โรงแรม 032-1234 #หัวหิน', 'โน้ตทริป #หัวหิน ', 'note_added'],
  ['แจ้งเตือน 25 ธ.ค. 2099 09:00 เช็คกระเป๋า', 'เตือน ', 'notification_set'],
  ['เตือน 25 ธ.ค. 2099 10:00 ซื้อนม', 'เตือน ', 'notification_set'],
  ['ตั้งงบ อาหาร 5000', 'ตั้งงบ ', 'budget_set'],
];

test('คำสั่งเพิ่มทุกชนิด: สำเร็จแล้วมีปุ่ม ➕ เพิ่มอีก เป็นปุ่มแรก (เปิดคีย์บอร์ดพร้อมคำสั่งตั้งต้น) และมี ✖ ยกเลิก ท้ายสุด', async () => {
  await setup();
  for (const [text, fill, type] of SUCCESS) {
    const r = await handleTextMessage(text, u1);
    assert.equal(r.type, type, `${text} → ${r.type}: ${r.reply}`);
    assert.equal(fillIns(r)[0], fill, `${text} → ${JSON.stringify(r.quickReplies)}`);
    assert.ok(r.quickReplies[0].fillIn != null, `${text}: ปุ่ม ➕ ต้องเป็นปุ่มแรก`);

    const items = toReplyPayload(r).quickReply.items;
    assert.equal(items[0].action.type, 'postback');
    assert.equal(items[0].action.inputOption, 'openKeyboard');
    assert.equal(items[0].action.fillInText, fill);
    assert.equal(items.at(-1).action.data, 'action=menu_cancel');
    assert.ok(items.length <= 13);
  }
});

test('ให้ของขวัญแฟน: หลังยืนยันบันทึกแล้ว มีปุ่ม 🎀 เพิ่มของขวัญอีก', async () => {
  await setup();
  await handleTextMessage('ให้ของขวัญแฟน นาฬิกา 2500', u2);
  const done = await handleTextMessage('ใช่', u2);
  assert.equal(done.type, 'gift_given');
  assert.equal(done.quickReplies[0].fillIn, 'ให้ของขวัญแฟน ');
  assert.equal(done.quickReplies[0].label, '🎀 เพิ่มของขวัญอีก');
});

test('พิมพ์ผิด/ข้อมูลไม่ครบ: มีปุ่ม ➕ ลองใหม่ เปิดคีย์บอร์ดพร้อมคำสั่งเดิม', async () => {
  await setup();
  const cases = [
    ['เพิ่มงาน พรุ่งนี้', 'เพิ่มงาน '],
    ['เพิ่มงาน ทดสอบ 31 ก.พ.', 'เพิ่มงาน '],
    ['เพิ่มวันสำคัญ วันเกิดแฟน', 'เพิ่มวันสำคัญ '],
    ['อยากได้ 3500', 'อยากได้ '],
    ['เพิ่มที่ #หัวหิน', 'เพิ่มที่ #หัวหิน '],
    ['โน้ตทริป #หัวหิน', 'โน้ตทริป #หัวหิน '],
    ['เตือน อะไรสักอย่าง', 'เตือน '],
    ['ตั้งงบ อาหาร', 'ตั้งงบ '],
    ['ตั้งงบ ไม่มีหมวดนี้ 100', 'ตั้งงบ '],
  ];
  for (const [text, fill] of cases) {
    const r = await handleTextMessage(text, u1);
    assert.equal(r.type, 'error', `${text} → ${r.type}: ${r.reply}`);
    assert.ok(fillIns(r).includes(fill), `${text} → ${JSON.stringify(r.quickReplies)}`);
  }
});

test('กดปุ่ม ➕ แล้วพิมพ์ต่อ (ข้อความตั้งต้น + สิ่งที่พิมพ์) บันทึกได้จริง เพิ่มซ้ำได้หลายรอบ', async () => {
  await setup();
  const first = await handleTextMessage('เพิ่มที่ ร้านA #หัวหิน', u1);
  const prefill = first.quickReplies[0].fillIn; // 'เพิ่มที่ #หัวหิน '
  for (const name of ['ร้านB', 'ร้านC', 'ร้านD']) {
    const r = await handleTextMessage(`${prefill}${name}`, u1);
    assert.equal(r.type, 'place_added', r.reply);
    assert.equal(r.quickReplies[0].fillIn, prefill); // ปุ่มยังอยู่ทุกรอบ
  }
  const list = await handleTextMessage('ที่เที่ยว หัวหิน', u1);
  for (const n of ['ร้านA', 'ร้านB', 'ร้านC', 'ร้านD']) assert.ok(list.reply.includes(n), list.reply);

  const note = await handleTextMessage('โน้ตทริป wifi รหัส 1234 #หัวหิน', u1);
  const noteFill = note.quickReplies[0].fillIn;
  const second = await handleTextMessage(`${noteFill}ที่จอดรถชั้น 2`, u1);
  assert.equal(second.type, 'note_added');

  const todoFill = (await handleTextMessage('เพิ่มงาน งาน1', u1)).quickReplies[0].fillIn;
  await handleTextMessage(`${todoFill}งาน2 พรุ่งนี้`, u1);
  assert.equal((await listOpenTodos()).length, 2);
});

test('ปุ่มดู (📍 ดูที่เที่ยว / 📝 ดูโน้ต) ส่งคำสั่งที่บอตเข้าใจจริง', async () => {
  await setup();
  const place = await handleTextMessage('เพิ่มที่ ร้านA #หัวหิน', u1);
  const note = await handleTextMessage('โน้ตทริป เบอร์ 032 #หัวหิน', u1);
  for (const r of [place, note]) {
    const view = r.quickReplies.find((q) => q.text);
    const out = await handleTextMessage(view.text, u1);
    assert.notEqual(out.type, 'error', `${view.text} → ${out.reply}`);
  }
});
