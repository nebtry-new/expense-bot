const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { buildRichMenus, BUTTONS, WIDTH, HEIGHT, ALIAS_MAIN, ALIAS_MORE, NAME_PREFIX } = require('../src/richmenu/definitions');
const { handleMenuPostback, MENU_QUESTIONS, MAX_QUICK_REPLIES, MAX_LABEL } = require('../src/handlers/commands/menu');
const { handleTextMessage } = require('../src/handlers/text');
const { resetData, registerUser, createTrip, addTripPlace, getTripPlaces } = require('../src/services/db');
const { __setInterpreter, __resetRateLimit } = require('../src/services/nl-intent');
const { clearAllState } = require('../src/handlers/state');
const { inspectPng } = require('../scripts/richmenu');

const u1 = { lineUserId: 'u1' };

async function setup() {
  await resetData();
  clearAllState();
  __resetRateLimit();
  await registerUser({ lineUserId: 'u1', displayName: 'ปิ๊ก' });
  await registerUser({ lineUserId: 'u2', displayName: 'แจม' });
}

// ---------- รูปแบบเมนู ----------

test('rich menu: two tabs, full size, <= 20 areas, bounds inside the image and non-overlapping', () => {
  const menus = buildRichMenus();
  for (const [tab, menu] of Object.entries(menus)) {
    assert.deepEqual(menu.size, { width: WIDTH, height: HEIGHT });
    assert.ok(menu.areas.length <= 20);
    assert.equal(menu.areas.length, 2 + 6, `${tab}: 2 tabs + 6 buttons`);
    assert.ok(menu.name.startsWith(NAME_PREFIX));
    assert.ok([...menu.chatBarText].length <= 14);

    for (const { bounds: b } of menu.areas) {
      assert.ok(b.x >= 0 && b.y >= 0 && b.x + b.width <= WIDTH && b.y + b.height <= HEIGHT, JSON.stringify(b));
    }
    // ไม่ทับกัน
    for (let i = 0; i < menu.areas.length; i++) {
      for (let j = i + 1; j < menu.areas.length; j++) {
        const a = menu.areas[i].bounds;
        const c = menu.areas[j].bounds;
        const overlap = a.x < c.x + c.width && c.x < a.x + a.width && a.y < c.y + c.height && c.y < a.y + a.height;
        assert.equal(overlap, false, `${tab}: area ${i} overlaps ${j}`);
      }
    }
    // ครอบเต็มภาพ (ไม่มีช่องว่างที่กดแล้วไม่เกิดอะไร)
    const covered = menu.areas.reduce((sum, { bounds: b }) => sum + b.width * b.height, 0);
    assert.equal(covered, WIDTH * HEIGHT);
  }
  assert.equal(menus.main.selected, true);
  assert.equal(menus.more.selected, false);
});

test('rich menu: tab switching targets the two aliases and every action is well-formed', () => {
  const { main, more } = buildRichMenus();
  for (const menu of [main, more]) {
    const [left, right] = menu.areas;
    assert.equal(left.action.type, 'richmenuswitch');
    assert.equal(left.action.richMenuAliasId, ALIAS_MAIN);
    assert.equal(right.action.richMenuAliasId, ALIAS_MORE);

    for (const { action } of menu.areas.slice(2)) {
      assert.ok(['message', 'postback'].includes(action.type));
      if (action.type === 'message') assert.ok(action.text && [...action.label].length <= 20);
      if (action.type === 'postback') {
        assert.ok(action.data.startsWith('action=menu_'));
        assert.ok(action.data.length <= 300);
        if (action.inputOption) assert.ok(action.fillInText);
      }
    }
  }
});

test('rich menu: message buttons send commands the bot really understands', async () => {
  await setup();
  const sent = Object.values(BUTTONS).flat().map((b) => b.action).filter((a) => a.type === 'message').map((a) => a.text);
  assert.deepEqual(sent.sort(), ['help', 'ลบรายการ', 'สรุป', 'สรุปยอดเดือนนี้'].sort());

  __setInterpreter(async () => { throw new Error('no model for fixed commands'); });
  for (const text of sent) {
    const r = await handleTextMessage(text, u1);
    assert.ok(r.reply || r.replyMessage, `"${text}" got no reply`);
    assert.notEqual(r.type, 'error', `"${text}" → ${r.reply}`);
  }
  __setInterpreter(null);
});

// ---------- postback จากเมนู ----------

function assertValidQuickReply(message) {
  const items = message.quickReply.items;
  assert.ok(items.length >= 1 && items.length <= MAX_QUICK_REPLIES);
  for (const item of items) {
    assert.equal(item.type, 'action');
    assert.ok([...item.action.label].length <= MAX_LABEL, item.action.label);
  }
}

test('menu_money shows the current balance and offers the existing money commands', async () => {
  await setup();
  await handleTextMessage('ค่าข้าว 100', u1);
  const m = await handleMenuPostback('action=menu_money', u1);
  assert.ok(m.text.includes('แจม ต้องจ่ายให้ ปิ๊ก 50'), m.text);
  assertValidQuickReply(m);
  assert.deepEqual(m.quickReply.items.map((i) => i.action.text), ['เรียกเก็บเงิน', 'จ่ายแล้ว', 'รับแล้ว']);
});

test('menu_trip lists real trips as postback buttons (at most 8, labels truncated)', async () => {
  await setup();
  for (const name of ['หัวหิน', 'เชียงใหม่', 'ภูเก็ต', 'กระบี่', 'ทริปที่มีชื่อยาวมากๆๆๆๆๆๆๆๆๆๆๆๆๆๆๆๆ']) await createTrip(name);
  const m = await handleMenuPostback('action=menu_trip', u1);
  assertValidQuickReply(m);
  const commands = m.quickReply.items.map((i) => i.action.text || i.action.fillInText);
  const tripButtons = m.quickReply.items.filter((i) => i.action.type === 'postback' && i.action.data.startsWith('action=menu_trip_detail'));
  assert.equal(tripButtons.length, 5);
  assert.ok(commands.includes('ทริป') && commands.includes('สร้างทริป '));
  // displayText (ที่ผู้ใช้เห็นในแชต) เป็นชื่อเต็ม แม้ label จะถูกตัด
  assert.ok(tripButtons.some((i) => i.action.displayText.includes('ชื่อยาว')));
});

const pbData = (m) => m.quickReply.items.map((i) => i.action.fillInText || i.action.data || i.action.text);
const tap = (m, labelPart) => m.quickReply.items.find((i) => i.action.label.includes(labelPart)).action.data;

test('trip hub: สรุป/โน้ต/ที่เที่ยว/เส้นทาง/ปิดทริป/กลับ และสลับปิด↔เปิดตามสถานะ', async () => {
  await setup();
  const trip = await createTrip('หัวหิน');
  const id = encodeURIComponent(trip.id);
  const m = await handleMenuPostback(`action=menu_trip_detail&id=${id}`, u1);
  assertValidQuickReply(m);
  assert.deepEqual(pbData(m), [
    'สรุปทริป หัวหิน', `action=menu_trip_notes&id=${id}`, `action=menu_trip_places&id=${id}`,
    'เส้นทางทริป หัวหิน', 'ปิดทริป หัวหิน', 'action=menu_trip',
  ]);

  await handleTextMessage('ปิดทริป หัวหิน', u1);
  const closed = await handleMenuPostback(`action=menu_trip_detail&id=${id}`, u1);
  assert.ok(pbData(closed).includes('เปิดทริป หัวหิน'));

  const gone = await handleMenuPostback('action=menu_trip_detail&id=nope', u1);
  assert.ok(gone.text.includes('ไม่พบทริป'));
  assert.ok((await handleMenuPostback('action=menu_trip_notes&id=nope', u1)).text.includes('ไม่พบทริป'));
});

test('trip notes sub menu: แสดงโน้ต + ปุ่มเพิ่มโน้ต + กลับ', async () => {
  await setup();
  const trip = await createTrip('หัวหิน');
  await handleTextMessage('โน้ตทริป เบอร์โรงแรม 032 #หัวหิน', u1);
  const m = await handleMenuPostback(`action=menu_trip_notes&id=${encodeURIComponent(trip.id)}`, u1);
  assertValidQuickReply(m);
  assert.ok(m.text.includes('เบอร์โรงแรม 032'));
  const data = pbData(m);
  assert.equal(data[0], 'โน้ตทริป #หัวหิน ');
  assert.ok(data.at(-1).startsWith('action=menu_trip_detail'));
});

test('trip places sub menu: ไปแล้ว / ลบที่ ผ่านปุ่มเลือก (ลบมีขั้นยืนยัน) อ้างด้วย id ไม่ใช่ชื่อ', async () => {
  await setup();
  const trip = await createTrip('หัวหิน');
  const id = encodeURIComponent(trip.id);
  await addTripPlace(trip.id, 'ร้านA', null, 'กิน');
  await addTripPlace(trip.id, 'ร้านA2', null, 'กิน'); // ชื่อทับกัน: ต้องไม่ไปจับตัวแรกแทน

  const places = await handleMenuPostback(`action=menu_trip_places&id=${id}`, u1);
  assertValidQuickReply(places);
  assert.ok(places.text.includes('ร้านA') && places.text.includes('ร้านA2'));
  const labels = places.quickReply.items.map((i) => i.action.label);
  assert.ok(labels.some((l) => l.includes('ไปแล้ว')) && labels.some((l) => l.includes('ลบที่')) && labels.some((l) => l.includes('เพิ่มที่เที่ยว')));

  const pick = await handleMenuPostback(tap(places, 'ไปแล้ว'), u1);
  assertValidQuickReply(pick);
  const second = pick.quickReply.items.find((i) => i.action.label.includes('ร้านA2')).action.data;
  const done = await handleMenuPostback(second, u1);
  assert.ok(done.text.startsWith('✅ "ร้านA2" บันทึกว่าไปแล้ว'), done.text);
  const rows = await getTripPlaces(trip.id);
  assert.equal(rows.find((p) => p.name === 'ร้านA2').status, 'visited');
  assert.notEqual(rows.find((p) => p.name === 'ร้านA').status, 'visited');

  // ลบ: เลือก → ถามยืนยัน → ใช่ ลบเลย (ถ้ากด ไม่ลบ ต้องไม่ลบอะไร)
  const delPick = await handleMenuPostback(tap(done, 'ลบที่'), u1);
  const ask = await handleMenuPostback(delPick.quickReply.items.find((i) => i.action.label.includes('ร้านA2')).action.data, u1);
  assert.ok(ask.text.includes('ใช่หรือไม่'));
  const no = await handleMenuPostback(tap(ask, 'ไม่ลบ'), u1);
  assert.equal((await getTripPlaces(trip.id)).length, 2);
  assert.ok(no.text.includes('ร้านA2'));

  const yes = await handleMenuPostback(tap(ask, 'ใช่ ลบเลย'), u1);
  assert.ok(yes.text.includes('ลบ "ร้านA2"'));
  assert.deepEqual((await getTripPlaces(trip.id)).map((p) => p.name), ['ร้านA']);

  // กดปุ่มเดิมซ้ำ (ที่ถูกลบไปแล้ว) → ไม่ error ไม่ลบรายการอื่น
  const again = await handleMenuPostback(tap(ask, 'ใช่ ลบเลย'), u1);
  assert.ok(again.text.includes('ถูกลบไปแล้ว'));
  assert.equal((await getTripPlaces(trip.id)).length, 1);
});

test('trip sub menu: ทริปที่ไม่มีที่เที่ยว → ไม่มีปุ่ม ไปแล้ว/ลบที่; ชื่อมีช่องว่าง → ไม่มีปุ่มเพิ่ม (#แท็กใช้ไม่ได้)', async () => {
  await setup();
  const trip = await createTrip('ทริป เชียงใหม่');
  const m = await handleMenuPostback(`action=menu_trip_places&id=${encodeURIComponent(trip.id)}`, u1);
  const labels = m.quickReply.items.map((i) => i.action.label);
  assert.ok(!labels.some((l) => l.includes('ไปแล้ว') || l.includes('ลบที่') || l.includes('เพิ่ม')), labels.join('|'));
  const notes = await handleMenuPostback(`action=menu_trip_notes&id=${encodeURIComponent(trip.id)}`, u1);
  assert.ok(!notes.quickReply.items.some((i) => i.action.label.includes('เพิ่ม')));
});

test('menu_ask / menu_ev / menu_record / unknown', async () => {
  await setup();
  const ask = await handleMenuPostback('action=menu_ask', u1);
  assertValidQuickReply(ask);
  assert.deepEqual(ask.quickReply.items.map((i) => i.action.text), Object.keys(MENU_QUESTIONS));

  const ev = await handleMenuPostback('action=menu_ev', u1);
  assertValidQuickReply(ev);
  assert.ok(ev.quickReply.items.some((i) => i.action.type === 'location'));

  assert.ok((await handleMenuPostback('action=menu_record', u1)).text.includes('ค่าข้าว'));
  assert.equal(await handleMenuPostback('action=menu_nope', u1), null);
});

test('menu_notify offers set/list notification commands the bot understands', async () => {
  await setup();
  const m = await handleMenuPostback('action=menu_notify', u1);
  assertValidQuickReply(m);
  assert.deepEqual(m.quickReply.items.map((i) => i.action.text), ['แจ้งเตือนใหม่', 'ดูแจ้งเตือน']);
});

test('menu_todo / menu_events: empty state offers the add button; real lists add ✅/❌ buttons and stay within 13', async () => {
  await setup();
  const emptyTodo = await handleMenuPostback('action=menu_todo', u1);
  assertValidQuickReply(emptyTodo);
  assert.deepEqual(pbData(emptyTodo), ['เพิ่มงาน ']);
  const emptyEvents = await handleMenuPostback('action=menu_events', u1);
  assert.deepEqual(pbData(emptyEvents), ['เพิ่มวันสำคัญ ']);

  for (let i = 1; i <= 15; i += 1) await handleTextMessage(`เพิ่มงาน งานที่ ${i}`, u1);
  await handleTextMessage('เพิ่มวันสำคัญ วันเกิดแฟน 14 มี.ค.', u1);

  const todo = await handleMenuPostback('action=menu_todo', u1);
  assertValidQuickReply(todo);
  assert.equal(todo.quickReply.items.length, MAX_QUICK_REPLIES);
  assert.equal(pbData(todo)[0], 'เพิ่มงาน ');
  assert.ok(pbData(todo).includes('เสร็จ 1'));
  // ปุ่มจากเมนูใช้เลขอ้างอิงลิสต์ที่เพิ่งแสดง → เสร็จ 1 ทำงานข้อแรกจริง
  const done = await handleTextMessage('เสร็จ 1', u1);
  assert.equal(done.type, 'todo_done');

  const ev = await handleMenuPostback('action=menu_events', u1);
  assertValidQuickReply(ev);
  assert.deepEqual(pbData(ev), ['เพิ่มวันสำคัญ ', 'ลบวันสำคัญ 1']);
  assert.ok(ev.text.includes('วันเกิดแฟน'));
});

// ---------- คำถามจากเมนูไม่ต้องใช้โมเดล ----------

test('menu questions are answered by code, even when the AI model is down', async () => {
  await setup();
  await handleTextMessage('ค่ากาแฟ 80', u1);
  __setInterpreter(async () => { throw new Error('AI down'); });

  const total = await handleTextMessage('เดือนนี้ใช้ไปเท่าไหร่', u1);
  assert.equal(total.type, 'nl_answer');
  assert.ok(total.reply.includes('รวม 80 บาท'), total.reply);

  const who = await handleTextMessage('ตอนนี้ใครต้องจ่ายใคร', u1);
  assert.ok(who.reply.includes('แจม ต้องจ่ายให้ ปิ๊ก 40'), who.reply);

  const recent = await handleTextMessage('รายการล่าสุด', u1);
  assert.ok(recent.reply.includes('ค่ากาแฟ 80'));
  __setInterpreter(null);
});

// ---------- ตรวจรูปก่อนอัปโหลด ----------

test('inspectPng accepts the guide image size and rejects wrong size / missing / non-PNG', () => {
  const guide = path.join(__dirname, '..', 'assets', 'richmenu', 'guide-main.png');
  const ok = inspectPng(guide);
  assert.equal(ok.width, WIDTH);
  assert.equal(ok.height, HEIGHT);
  assert.ok(ok.buffer.length < 1024 * 1024);

  assert.ok(inspectPng('/no/such/file.png').error.includes('ไม่พบไฟล์'));

  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'richmenu-'));
  const notPng = path.join(tmp, 'x.png');
  fs.writeFileSync(notPng, Buffer.from('not a png at all, just text content here'));
  assert.ok(inspectPng(notPng).error.includes('ไม่ใช่ไฟล์ PNG'));

  // PNG header ปลอมขนาด 100×100
  const header = Buffer.alloc(33);
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(header, 0);
  header.writeUInt32BE(13, 8);
  header.write('IHDR', 12);
  header.writeUInt32BE(100, 16);
  header.writeUInt32BE(100, 20);
  const small = path.join(tmp, 'small.png');
  fs.writeFileSync(small, header);
  assert.ok(inspectPng(small).error.includes('ต้องเป็น 2500×1686'));
  fs.rmSync(tmp, { recursive: true });
});
