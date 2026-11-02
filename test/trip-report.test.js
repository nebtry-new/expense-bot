const test = require('node:test');
const assert = require('node:assert/strict');
const { handleTextMessage } = require('../src/handlers/text');
const { handleMenuPostback } = require('../src/handlers/commands/menu');
const { resetData, registerUser, findTripByName } = require('../src/services/db');
const { clearAllState } = require('../src/handlers/state');
const { buildTripReport } = require('../src/utils/trip-report');

const A = { lineUserId: 'uA' };
const B = { lineUserId: 'uB' };

async function setup() {
  await resetData();
  clearAllState();
  await registerUser({ lineUserId: 'uA', displayName: 'ปิ๊ก' });
  await registerUser({ lineUserId: 'uB', displayName: 'แจม' });
}

async function closedTrip() {
  await setup();
  await handleTextMessage('สร้างทริป หัวหิน', A);
  await handleTextMessage('ค่าโรงแรม 2400 #หัวหิน', A);
  await handleTextMessage('ค่าข้าว 600 #หัวหิน', B);
  await handleTextMessage('ค่ากาแฟ 80 ส่วนตัว #หัวหิน', B);
  await handleTextMessage('ปิดทริป หัวหิน', A);
}

test('สรุปทริป: ทริปที่ปิดแล้ว แจกแจงยอดรวม ตามคนจ่าย ตามหมวด และทุกรายการ', async () => {
  await closedTrip();
  const r = await handleTextMessage('สรุปทริป หัวหิน', A);
  assert.equal(r.type, 'trip_summary');
  const text = r.reply;
  assert.ok(text.includes('สรุปทริป "หัวหิน" (ปิดทริปแล้ว)'), text);
  assert.ok(text.includes('ใช้จ่ายรวม 3,080 บาท · 3 รายการ'), text);
  assert.ok(text.includes('ปิ๊ก จ่ายไป 2,400') && text.includes('แจม จ่ายไป 680'), text);
  assert.ok(text.includes('🏷 แยกหมวด') && text.includes('✈️ ท่องเที่ยว/ที่พัก 2,400 บาท (78%)'), text);
  assert.ok(text.includes('ค่าโรงแรม 2,400 บาท (ปิ๊ก)'), text);
  assert.ok(text.includes('ค่าข้าว 600 บาท (แจม)'), text);
  assert.ok(text.includes('ค่ากาแฟ 80 บาท (แจม) · ส่วนตัว'), text); // รายการส่วนตัวกำกับไว้ (ไม่นับในยอดเรียกเก็บ)
  assert.ok(text.includes('⏳ ยังไม่เคลียร์ 3 รายการ'), text);
});

test('สรุปทริป: ทริปยังไม่ปิดก็บอกสถานะ และทริปที่ไม่มีรายการยังตอบเหมือนเดิม', async () => {
  await setup();
  await handleTextMessage('สร้างทริป เชียงใหม่', A);
  assert.ok((await handleTextMessage('สรุปทริป เชียงใหม่', A)).reply.includes('ยังไม่มีค่าใช้จ่าย'));
  await handleTextMessage('ค่าข้าว 100 #เชียงใหม่', A);
  assert.ok((await handleTextMessage('สรุปทริป เชียงใหม่', A)).reply.includes('(ยังไม่ปิดทริป)'));
});

test('รายการทริป (ทริป): แสดงสถานะ + ยอดใช้จ่าย + จำนวนรายการของแต่ละทริป', async () => {
  await closedTrip();
  await handleTextMessage('สร้างทริป ภูเก็ต', A);
  const r = await handleTextMessage('ทริป', A);
  assert.equal(r.type, 'trips');
  assert.ok(r.reply.includes('1. หัวหิน — ปิดทริปแล้ว · ใช้จ่ายรวม 3,080 บาท (3 รายการ)'), r.reply);
  assert.ok(r.reply.includes('2. ภูเก็ต — ยังไม่ปิด · ยังไม่มีรายการ'), r.reply);
  assert.ok(r.reply.includes('สรุปทริป [ชื่อทริป]'), r.reply);
});

test('เมนูทริป (ปุ่ม ทริป → เลือกทริป): แสดงยอดใช้จ่ายรวมของทริปที่ปิดแล้ว + ปุ่มดูรายการ', async () => {
  await closedTrip();
  const trip = await findTripByName('หัวหิน');
  const m = await handleMenuPostback(`action=menu_trip_detail&id=${encodeURIComponent(trip.id)}`, A);
  assert.ok(m.text.includes('ปิดทริปแล้ว') && m.text.includes('💰 ใช้จ่ายรวม 3,080 บาท (3 รายการ)'), m.text);
  const summaryBtn = m.quickReply.items.find((i) => i.action.text === 'สรุปทริป หัวหิน');
  assert.ok(summaryBtn && summaryBtn.action.label.includes('รายการ'));
});

test('buildTripReport: ทริปยาวไม่ล้นขีดจำกัดข้อความ LINE (ตัดท้ายพร้อมสรุปที่เหลือ)', () => {
  const users = [{ id: 'a', displayName: 'ปิ๊ก' }];
  const expenses = Array.from({ length: 120 }, (_, i) => ({
    id: String(i), description: `รายการยาวๆ หมายเลข ${i + 1}`, amount: 100, paidByUserId: 'a', createdAt: new Date(Date.UTC(2026, 8, 1 + (i % 28))).toISOString(),
  }));
  const lines = buildTripReport({ trip: { name: 'ยาว', is_billable: true }, expenses, users });
  const text = lines.join('\n');
  assert.ok(text.length < 4000, `ยาว ${text.length}`);
  assert.ok(/… และอีก \d+ รายการ \(รวม [\d,]+ บาท\)/.test(lines.at(-1)), lines.at(-1));
  assert.ok(text.includes('ใช้จ่ายรวม 12,000 บาท · 120 รายการ')); // หัวรายงานยังนับครบทุกรายการ
});
