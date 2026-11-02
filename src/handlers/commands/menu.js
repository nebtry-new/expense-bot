// ตอบ postback จาก Rich menu (action=menu_*) ด้วยข้อความ + quick reply ให้เลือกขั้นต่อไป
// ทุกตัวเลือกเป็น "ข้อความคำสั่งเดิม" จึงผ่าน flow/ขั้นตอนยืนยันเดิมทั้งหมด
const { getTrips } = require('../../services/db');
const { answerForUser } = require('./nl-dispatch');

const MAX_QUICK_REPLIES = 13;
const MAX_LABEL = 20;

// วลีคำถามสำเร็จรูปที่ปุ่ม "ถามข้อมูล" ส่งมา — text.js ตอบตรงๆ ไม่ต้องเรียกโมเดล
const MENU_QUESTIONS = {
  'เดือนนี้ใช้ไปเท่าไหร่': { kind: 'total', period: 'this_month' },
  'เดือนที่แล้วใช้ไปเท่าไหร่': { kind: 'total', period: 'last_month' },
  'ตอนนี้ใครต้องจ่ายใคร': { kind: 'balance' },
  'รายการล่าสุด': { kind: 'recent', limit: 5 },
};

const truncate = (s, n = MAX_LABEL) => {
  const chars = [...String(s)];
  return chars.length > n ? `${chars.slice(0, n - 1).join('')}…` : chars.join('');
};

const sayItem = (label, text = label) => ({ type: 'action', action: { type: 'message', label: truncate(label), text } });
const fillItem = (label, fillInText) => ({
  type: 'action',
  action: { type: 'postback', label: truncate(label), data: 'action=noop', inputOption: 'openKeyboard', fillInText },
});

const withQuickReplies = (text, items) => ({
  type: 'text',
  text,
  quickReply: { items: items.slice(0, MAX_QUICK_REPLIES) },
});

async function handleMenuPostback(data, userContext = {}) {
  const action = String(data || '').replace(/^action=/, '');

  if (action === 'menu_record') {
    // ถ้า LINE ส่ง event มาหลังเปิดคีย์บอร์ด ให้ตัวอย่างสั้นๆ (ถ้าไม่ส่งมา ก็ไม่เสียหาย)
    return { type: 'text', text: 'พิมพ์ได้เลย เช่น\n• ค่าข้าว 350\n• ค่าโรงแรม 1200 ฉัน 400 แฟน 800\n• เลี้ยงข้าวแฟน 450\n• ปิ๊กยืมแจม 500\nหรือส่งรูป slip มาได้เลย 📸' };
  }

  if (action === 'menu_money') {
    const status = await answerForUser({ kind: 'balance' }, userContext);
    return withQuickReplies(`${status.reply || 'ไม่พบข้อมูล'}\n\nต้องการทำอะไร?`, [
      sayItem('เรียกเก็บเงิน'),
      sayItem('จ่ายแล้ว'),
      sayItem('รับแล้ว'),
    ]);
  }

  if (action === 'menu_trip') {
    const trips = (await getTrips()).slice(0, 4);
    const items = [sayItem('ดูทริปทั้งหมด', 'ทริป')];
    for (const t of trips) items.push(sayItem(`สรุป ${t.name}`, `สรุปทริป ${t.name}`));
    items.push(fillItem('สร้างทริปใหม่', 'สร้างทริป '));
    const hint = trips.length ? 'เลือกทริปที่ต้องการสรุป หรือสร้างทริปใหม่' : 'ยังไม่มีทริป สร้างทริปใหม่ได้เลย';
    return withQuickReplies(`✈️ ทริป\n${hint}\n(ปิดทริปเมื่อพร้อมเรียกเก็บ: ปิดทริป ชื่อ)`, items);
  }

  if (action === 'menu_ask') {
    return withQuickReplies('💬 ถามได้เลย หรือพิมพ์คำถามเองก็ได้ เช่น "เดือนนี้กินกาแฟไปเท่าไหร่"', [
      ...Object.keys(MENU_QUESTIONS).map((q) => sayItem(q)),
    ]);
  }

  if (action === 'menu_ev') {
    return withQuickReplies(
      '🔌 หาจุดชาร์จ EV\n• ส่ง Google Maps directions link แล้วบอกแบต %\n• หรือแชร์ตำแหน่งปัจจุบัน → ส่งปลายทาง → บอกแบต %\n(ตั้งค่าระยะรถก่อน: ตั้งค่ารถ 400 กม.)',
      [{ type: 'action', action: { type: 'location', label: 'แชร์ตำแหน่ง' } }, fillItem('ตั้งค่ารถ', 'ตั้งค่ารถ ')],
    );
  }

  return null;
}

module.exports = { handleMenuPostback, MENU_QUESTIONS, MAX_QUICK_REPLIES, MAX_LABEL };
