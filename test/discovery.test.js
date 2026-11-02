const test = require('node:test');
const assert = require('node:assert/strict');
const { handleTextMessage } = require('../src/handlers/text');
const { resetData, registerUser, listRestaurants, listWishItems, listGifts, addSpecialEvent, addWishItem, addGift } = require('../src/services/db');
const { clearAllState } = require('../src/handlers/state');
const { __setPlaceResolver, parsePlaceFromUrl, extractMapsLink } = require('../src/utils/maps-place');
const { __setRandom } = require('../src/handlers/commands/restaurants');
const { parseTitlePrice, similar } = require('../src/handlers/commands/gifts');
const { runGiftHints, eventTarget, __setGreetingWriter } = require('../src/services/planner-reminders');

const u1 = { lineUserId: 'u1' };
const u2 = { lineUserId: 'u2' };

async function setup() {
  await resetData();
  clearAllState();
  __setRandom(null);
  __setGreetingWriter(async () => null);
  __setPlaceResolver(async (url) => ({ name: /\/a\d/.test(url) ? 'ร้านต้มยำ' : null, lat: 13.7, lng: 100.5, url: `${url}/full` }));
  await registerUser({ lineUserId: 'u1', displayName: 'ปิ๊ก' });
  await registerUser({ lineUserId: 'u2', displayName: 'แจม' });
}

const NOW = new Date('2026-11-02T03:00:00Z'); // 2 พ.ย. 2026 10:00 ไทย

// ---------- ลิงก์ Maps ----------

test('maps-place: อ่านชื่อ/พิกัดจาก URL เต็ม และเจอลิงก์ในข้อความ', () => {
  const url = 'https://www.google.com/maps/place/%E0%B8%A3%E0%B9%89%E0%B8%B2%E0%B8%99+%E0%B8%95%E0%B9%89%E0%B8%A1%E0%B8%A2%E0%B8%B3/@13.7563,100.5018,17z/data=!3d13.7561!4d100.5019';
  assert.deepEqual(parsePlaceFromUrl(url), { name: 'ร้าน ต้มยำ', lat: 13.7561, lng: 100.5019 });
  assert.equal(parsePlaceFromUrl('https://www.google.com/maps?q=13.75,100.5').name, null);
  assert.equal(extractMapsLink('เพิ่มร้าน https://maps.app.goo.gl/abc ชื่อ'), 'https://maps.app.goo.gl/abc');
  assert.equal(extractMapsLink('https://example.com/x'), null);
});

// ---------- ร้านอาหาร ----------

test('เพิ่มร้าน: จากลิงก์ (ดึงชื่อเอง) / ชื่อเอง / ชื่อเองทับ / ซ้ำ / ไม่มีชื่อ', async () => {
  await setup();
  const a = await handleTextMessage('เพิ่มร้าน https://maps.app.goo.gl/a1', u1);
  assert.equal(a.type, 'restaurant_added');
  assert.ok(a.reply.includes('ร้านต้มยำ') && a.reply.includes('/full'), a.reply);

  const named = await handleTextMessage('เพิ่มร้าน ซูชิโอะ https://maps.app.goo.gl/a2', u2);
  assert.ok(named.reply.includes('ซูชิโอะ'));
  assert.equal((await handleTextMessage('เพิ่มร้าน ข้าวมันไก่', u1)).type, 'restaurant_added'); // ไม่มีลิงก์ก็ได้

  assert.equal((await handleTextMessage('เพิ่มร้าน ร้านต้มยำ', u1)).type, 'noop'); // ซ้ำ
  assert.equal((await handleTextMessage('เพิ่มร้าน https://maps.app.goo.gl/zzz', u1)).type, 'error'); // อ่านชื่อไม่ได้ ต้องระบุเอง
  assert.equal((await listRestaurants()).length, 3);
});

test('สุ่มร้าน: ข้ามร้านที่ไปแล้ว ไม่ซ้ำร้านเดิม กรองด้วยคำค้น และไปครบแล้วสุ่มจากทั้งหมด', async () => {
  await setup();
  for (const n of ['ราเมน', 'ส้มตำ', 'ซูชิ']) await handleTextMessage(`เพิ่มร้าน ${n}`, u1);

  __setRandom(() => 0);
  const first = await handleTextMessage('สุ่มร้าน', u1);
  assert.equal(first.type, 'restaurant_pick');
  assert.ok(first.reply.includes('ราเมน'));
  const again = await handleTextMessage('สุ่มร้าน', u1); // random=0 อีกครั้ง แต่ไม่ซ้ำร้านเดิม
  assert.ok(!again.reply.includes('ราเมน'), again.reply);

  const done = await handleTextMessage('ไปกินแล้ว', u1); // ร้านที่สุ่มล่าสุด
  assert.equal(done.type, 'restaurant_visited');
  assert.equal((await handleTextMessage('ไปกินแล้ว', u1)).type, 'noop'); // ไม่มีร้านที่รอ

  const filtered = await handleTextMessage('สุ่มร้าน ซูชิ', u1);
  assert.ok(filtered.reply.includes('ซูชิ'));
  assert.equal((await handleTextMessage('สุ่มร้าน พิซซ่า', u1)).type, 'noop');

  // ทำให้ทุกร้านเป็น "ไปแล้ว" → สุ่มจากทั้งหมดแทน
  await handleTextMessage('ร้านอาหาร', u1);
  await handleTextMessage('ร้านไปแล้ว 1-3', u1);
  const all = await handleTextMessage('สุ่มร้าน', u1);
  assert.equal(all.type, 'restaurant_pick');
  assert.ok(all.reply.includes('ไปครบทุกร้านแล้ว'), all.reply);
});

test('ร้านอาหาร: ลิสต์ ไปแล้ว/ลบ อ้างเลขจากลิสต์ที่แสดงล่าสุด และไม่ทำซ้ำ', async () => {
  await setup();
  for (const n of ['ก', 'ข', 'ค']) await handleTextMessage(`เพิ่มร้าน ${n}${n}`, u1);
  assert.equal((await handleTextMessage('ลบร้าน 1', u1)).type, 'noop'); // ยังไม่ดูลิสต์

  const list = await handleTextMessage('ร้านอาหาร', u1);
  assert.ok(list.reply.includes('1. กก') && list.reply.includes('3. คค'));
  assert.equal((await handleTextMessage('ร้านไปแล้ว 9', u1)).type, 'error');

  assert.equal((await handleTextMessage('ร้านไปแล้ว 2', u1)).type, 'restaurant_visited');
  const relist = await handleTextMessage('ร้านอาหาร', u1);
  assert.ok(relist.reply.includes('✅ ขข') && relist.reply.indexOf('กก') < relist.reply.indexOf('ขข')); // ที่ไปแล้วอยู่ท้ายลิสต์

  const del = await handleTextMessage('ลบร้าน 1', u1);
  assert.equal(del.type, 'restaurant_deleted');
  assert.equal((await listRestaurants()).length, 2);
});

// ---------- ของขวัญ ----------

test('parseTitlePrice / similar', () => {
  assert.deepEqual(parseTitlePrice('หูฟัง 3,500'), { title: 'หูฟัง', price: 3500 });
  assert.deepEqual(parseTitlePrice('iPhone 15'), { title: 'iPhone 15', price: null }); // < 100 ไม่มีหน่วย = ชื่อรุ่น
  assert.deepEqual(parseTitlePrice('ขนม 50 บาท'), { title: 'ขนม', price: 50 });
  assert.ok(similar('นาฬิกา Casio', 'นาฬิกา'));
  assert.ok(!similar('ab', 'abc'));
});

test('wishlist: จดของที่อยากได้ ดูของแฟน และลบ', async () => {
  await setup();
  assert.equal((await handleTextMessage('อยากได้ หูฟังไร้สาย 3500', u1)).type, 'wish_added');
  assert.equal((await handleTextMessage('อยากได้ หูฟัง', u1)).type, 'noop'); // ซ้ำ
  await handleTextMessage('อยากได้ กระเป๋า 1200', u1);

  const mine = await handleTextMessage('ของที่อยากได้', u1);
  assert.ok(mine.reply.includes('1. หูฟังไร้สาย (฿3,500)') && mine.reply.includes('2. กระเป๋า'));

  const partner = await handleTextMessage('ของขวัญแฟน', u2); // u2 ดู wishlist ของ u1
  assert.ok(partner.reply.includes('ของขวัญสำหรับ ปิ๊ก') && partner.reply.includes('หูฟังไร้สาย'), partner.reply);
  assert.equal((await handleTextMessage('ของขวัญแฟน', u1)).type, 'partner_gifts'); // ของแฟน (ว่าง) ไม่ error

  const del = await handleTextMessage('ลบของที่อยากได้ 2', u1);
  assert.equal(del.type, 'wish_deleted');
  assert.equal((await listWishItems({ ownerLineUserId: 'u1' })).length, 1);
});

test('ให้ของขวัญแฟน: บันทึกประวัติ ปิด wishlist ที่ตรงกัน เตือนซ้ำต้องยืนยัน', async () => {
  await setup();
  await handleTextMessage('อยากได้ นาฬิกา 2500', u1);
  await handleTextMessage('อยากได้ กระเป๋า 1200', u1);
  await handleTextMessage('ของขวัญแฟน', u2);

  const byNumber = await handleTextMessage('ให้ของขวัญแฟน 1', u2); // นาฬิกา จาก wishlist ของ u1
  assert.equal(byNumber.type, 'gift_given');
  assert.ok(byNumber.reply.includes('นาฬิกา') && byNumber.reply.includes('ค่าของขวัญ'), byNumber.reply);
  assert.deepEqual((await listWishItems({ ownerLineUserId: 'u1' })).map((w) => w.title), ['กระเป๋า']); // นาฬิกาปิดแล้ว

  const dup = await handleTextMessage('ให้ของขวัญแฟน นาฬิกา Casio 3000', u2);
  assert.equal(dup.type, 'gift_duplicate');
  assert.ok(dup.reply.includes('เคยให้'), dup.reply);
  assert.equal((await listGifts()).length, 1); // ยังไม่บันทึก
  assert.equal(dup.quickReplies[0].text, 'ให้ของขวัญแฟน นาฬิกา Casio 3000 ยืนยัน');

  assert.equal((await handleTextMessage(dup.quickReplies[0].text, u2)).type, 'gift_given');
  assert.equal((await listGifts()).length, 2);

  const typed = await handleTextMessage('ให้ของขวัญแฟน กระเป๋าผ้า', u2); // ชื่อคล้าย wishlist → ปิดให้ด้วย
  assert.equal(typed.type, 'gift_given');
  assert.equal((await listWishItems({ ownerLineUserId: 'u1' })).length, 0);

  const history = await handleTextMessage('ประวัติของขวัญ', u1);
  assert.ok(history.reply.includes('ได้จากแจม') && history.reply.includes('นาฬิกา'), history.reply);
  assert.ok((await handleTextMessage('ประวัติของขวัญ', u2)).reply.includes('ให้ปิ๊ก'));
});

test('ให้ของขวัญแฟน: เลขที่ไม่มีลิสต์/เลขเกิน/ไม่มีแฟน', async () => {
  await setup();
  assert.equal((await handleTextMessage('ให้ของขวัญแฟน 1', u2)).type, 'noop');
  await handleTextMessage('อยากได้ นาฬิกา 2500', u1);
  await handleTextMessage('ของขวัญแฟน', u2);
  assert.equal((await handleTextMessage('ให้ของขวัญแฟน 7', u2)).type, 'error');

  await resetData();
  clearAllState();
  await registerUser({ lineUserId: 'u1', displayName: 'ปิ๊ก' });
  assert.equal((await handleTextMessage('ของขวัญแฟน', u1)).type, 'error'); // ยังมีแค่คนเดียว
});

// ---------- hint ก่อนวันสำคัญ ----------

test('eventTarget: ชื่อผู้ใช้ / แฟน / ฉัน / ครบรอบ(ไม่รู้)', async () => {
  await setup();
  const users = [{ lineUserId: 'u1', displayName: 'ปิ๊ก' }, { lineUserId: 'u2', displayName: 'แจม' }];
  const t = (title, by = 'u1') => eventTarget({ title, createdByLineUserId: by }, users)?.displayName ?? null;
  assert.equal(t('วันเกิดแจม'), 'แจม');
  assert.equal(t('วันเกิดแฟน'), 'แจม');
  assert.equal(t('วันเกิดแฟน', 'u2'), 'ปิ๊ก');
  assert.equal(t('วันเกิดฉัน'), 'ปิ๊ก');
  assert.equal(t('ครบรอบ'), null);
  assert.equal(t('วันเกิดปิ๊กและแจม'), null);
});

test('hint ของขวัญ: 7 และ 1 วันก่อน ส่งให้อีกฝ่าย (ไม่ใช่เจ้าของวันเกิด) พร้อม wishlist + ของที่เคยให้ ไม่ส่งซ้ำ', async () => {
  await setup();
  // u1 สร้าง "วันเกิดแฟน" → เจ้าของวันเกิดคือ u2 (แจม) → hint ไปที่ u1 (ปิ๊ก)
  await addSpecialEvent({ title: 'วันเกิดแฟน', month: 11, day: 9, kind: 'birthday', lineUserId: 'u1' }); // อีก 7 วัน
  await addSpecialEvent({ title: 'ครบรอบ', month: 11, day: 9, kind: 'anniversary', lineUserId: 'u1' }); // ไม่รู้เจ้าของ → ไม่ส่ง hint
  await addWishItem({ ownerLineUserId: 'u2', title: 'หูฟัง', price: 3500 });
  await addGift({ giverLineUserId: 'u1', recipientLineUserId: 'u2', title: 'น้ำหอม' });

  const sent = [];
  const send = async (to, text) => { sent.push({ to, text }); return true; };
  assert.equal((await runGiftHints(send, NOW)).sent, 1);
  assert.equal(sent.length, 1);
  assert.equal(sent[0].to, 'u1');
  assert.ok(sent[0].text.includes('หูฟัง') && sent[0].text.includes('(฿3,500)') && sent[0].text.includes('น้ำหอม'), sent[0].text);
  assert.ok(sent[0].text.includes('อีก 7 วัน'));

  assert.equal((await runGiftHints(send, NOW)).sent, 0); // ไม่ส่งซ้ำ

  // วันก่อนหน้า 1 วัน → ส่งอีกรอบ (key ต่างกัน)
  const dayBefore = new Date('2026-11-08T03:00:00Z');
  assert.equal((await runGiftHints(send, dayBefore)).sent, 1);
  assert.ok(sent[1].text.includes('พรุ่งนี้'));

  // ไม่มี wishlist → บอกให้ลองถาม
  await setup();
  await addSpecialEvent({ title: 'วันเกิดแจม', month: 11, day: 9, kind: 'birthday', lineUserId: 'u1' });
  const none = [];
  await runGiftHints(async (to, text) => { none.push({ to, text }); return true; }, NOW);
  assert.ok(none[0].text.includes('ยังไม่ได้จด wishlist'), none[0]?.text);
});
