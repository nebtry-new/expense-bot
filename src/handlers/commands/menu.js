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

// ปุ่มที่ส่ง postback (ผู้ใช้เห็นเป็นข้อความ displayText ในแชต)
const postbackItem = (label, data, displayText = label) => ({
  type: 'action',
  action: { type: 'postback', label: truncate(label), data, displayText: truncate(displayText, 300) },
});

// #แท็ก ใช้ได้เฉพาะชื่อที่ไม่มีช่องว่าง/อักขระพิเศษ (ตรงกับ regex ใน trip.js)
const isTaggable = (name) => /^[฀-๿a-zA-Z0-9_]+$/.test(name);

const MAX_TRIP_BUTTONS = 8;

const withQuickReplies = (text, items) => ({
  type: 'text',
  text,
  quickReply: { items: items.slice(0, MAX_QUICK_REPLIES) },
});

async function handleMenuPostback(data, userContext = {}) {
  const params = new URLSearchParams(String(data || ''));
  const action = params.get('action') || '';

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
    const trips = (await getTrips()).slice(0, MAX_TRIP_BUTTONS);
    const items = [sayItem('ดูทริปทั้งหมด', 'ทริป')];
    for (const t of trips) items.push(postbackItem(`✈️ ${t.name}`, `action=menu_trip_detail&id=${encodeURIComponent(t.id)}`, t.name));
    items.push(fillItem('สร้างทริปใหม่', 'สร้างทริป '));
    const hint = trips.length ? 'เลือกทริปเพื่อดูสรุป โน้ต สถานที่ หรือปิดทริป' : 'ยังไม่มีทริป สร้างทริปใหม่ได้เลย';
    return withQuickReplies(`✈️ ทริป\n${hint}`, items);
  }

  if (action === 'menu_trip_detail') {
    const trip = (await getTrips()).find((t) => String(t.id) === params.get('id'));
    if (!trip) return { type: 'text', text: 'ไม่พบทริปนี้แล้ว (อาจถูกลบ) แตะ ทริป ในเมนูเพื่อเลือกใหม่' };
    const n = trip.name;
    const items = [
      sayItem('📊 สรุปทริป', `สรุปทริป ${n}`),
      sayItem('📝 ดูโน้ต', `โน้ต ${n}`),
      sayItem('📍 ที่เที่ยว', `ที่เที่ยว ${n}`),
      sayItem('🗺 เส้นทาง', `เส้นทางทริป ${n}`),
    ];
    if (isTaggable(n)) {
      items.push(fillItem('➕ เพิ่มโน้ต', `โน้ตทริป #${n} `));
      items.push(fillItem('➕ เพิ่มที่เที่ยว', `เพิ่มที่ #${n} `));
    }
    items.push(trip.is_billable === true
      ? sayItem('เปิดทริปอีกครั้ง', `เปิดทริป ${n}`)
      : sayItem('✅ ปิดทริป (เรียกเก็บได้)', `ปิดทริป ${n}`));
    const state = trip.is_billable === true ? 'ปิดทริปแล้ว (รวมใน สรุป)' : 'ยังไม่ปิดทริป (ยังไม่รวมใน สรุป)';
    return withQuickReplies(`✈️ ${n}\n${state}\nเลือกสิ่งที่ต้องการ`, items);
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
