// ตอบ postback จาก Rich menu (action=menu_*) ด้วยข้อความ + quick reply ให้เลือกขั้นต่อไป
// ทุกตัวเลือกเป็น "ข้อความคำสั่งเดิม" จึงผ่าน flow/ขั้นตอนยืนยันเดิมทั้งหมด
const { getTrips, listRestaurants, getTripPlaces, markTripPlaceVisitedById, deleteTripPlaceById } = require('../../services/db');
const { handleListNotes, handleListPlaces } = require('./trip');
const { handleListTodos, handleListEvents } = require('./planner');
const { answerForUser } = require('./nl-dispatch');
const { cancelItem } = require('../../utils/quick-reply');
const { deleteListState, deleteConfirmState, nlCommandState, notifListState, eventListState, todoListState, restaurantListState, restaurantPickState, wishListState, partnerWishState, giftConfirmState } = require('../state');

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
const MAX_PLACE_BUTTONS = 11; // + ปุ่ม กลับ + ปุ่ม ยกเลิก = 13

// ทุกเมนูย่อยมีปุ่ม ✖ ยกเลิก เป็นปุ่มสุดท้าย (กันคนงงถ้าไม่อยากทำอะไรต่อ) — กันที่ไว้ 1 ช่องจากขีดจำกัด 13

const withQuickReplies = (text, items) => ({
  type: 'text',
  text,
  quickReply: { items: [...items.slice(0, MAX_QUICK_REPLIES - 1), cancelItem()] },
});

// ยกเลิก = ไม่ทำอะไรต่อ: ล้างลิสต์/คำขอยืนยันที่ค้างจากเมนู เพื่อไม่ให้เลขที่พิมพ์ทีหลังไปทำกับรายการที่ทิ้งไปแล้ว
// (ไม่แตะ flow เรื่องเงิน/สลิป/EV ที่เป็นงานของตัวเอง)
const CANCELLABLE_STATES = [deleteListState, deleteConfirmState, nlCommandState, notifListState, eventListState, todoListState, restaurantListState, restaurantPickState, wishListState, partnerWishState, giftConfirmState];
function clearMenuState(lineUserId) {
  for (const state of CANCELLABLE_STATES) delete state.pendingByUser[lineUserId];
}

const tripPb = (action, trip, extra = '') => `action=${action}&id=${encodeURIComponent(trip.id)}${extra}`;
const backToHub = (trip) => postbackItem('← กลับ', tripPb('menu_trip_detail', trip), `กลับ ${trip.name}`);

// ชั้นที่ 2: เมนูของทริป
function tripHub(trip, prefix = '') {
  const n = trip.name;
  const closed = trip.is_billable === true;
  const items = [
    sayItem('📊 สรุปทริป', `สรุปทริป ${n}`),
    postbackItem('📝 โน้ต', tripPb('menu_trip_notes', trip), `โน้ต ${n}`),
    postbackItem('📍 ที่เที่ยว', tripPb('menu_trip_places', trip), `ที่เที่ยว ${n}`),
    sayItem('🗺 เส้นทาง', `เส้นทางทริป ${n}`),
    closed ? sayItem('เปิดทริปอีกครั้ง', `เปิดทริป ${n}`) : sayItem('✅ ปิดทริป (เรียกเก็บได้)', `ปิดทริป ${n}`),
    postbackItem('← ทริปอื่น', 'action=menu_trip', 'ทริป'),
  ];
  const state = closed ? 'ปิดทริปแล้ว (รวมใน สรุป)' : 'ยังไม่ปิดทริป (ยังไม่รวมใน สรุป)';
  return withQuickReplies(`${prefix}✈️ ${n}\n${state}\nเลือกสิ่งที่ต้องการ`, items);
}

// ชั้นที่ 3: โน้ต / ที่เที่ยว — แสดงรายการ + ปุ่มจัดการ
async function notesMenu(trip) {
  const notes = await handleListNotes(trip.name);
  const items = [];
  if (isTaggable(trip.name)) items.push(fillItem('➕ เพิ่มโน้ต', `โน้ตทริป #${trip.name} `));
  items.push(backToHub(trip));
  return withQuickReplies(notes.reply, items);
}

async function placesMenu(trip, prefix = '') {
  const [list, places] = await Promise.all([handleListPlaces(trip.name), getTripPlaces(trip.id)]);
  const items = [];
  if (isTaggable(trip.name)) items.push(fillItem('➕ เพิ่มที่เที่ยว', `เพิ่มที่ #${trip.name} `));
  if (places.some((p) => p.status !== 'visited')) items.push(postbackItem('✓ ไปแล้ว', tripPb('menu_trip_visit', trip), 'ทำเครื่องหมายว่าไปแล้ว'));
  if (places.length) items.push(postbackItem('🗑 ลบที่', tripPb('menu_trip_del', trip), 'ลบที่เที่ยว'));
  items.push(sayItem('🗺 เส้นทาง', `เส้นทางทริป ${trip.name}`));
  items.push(backToHub(trip));
  return withQuickReplies(`${prefix}${list.reply}`, items);
}

const placeButtons = (trip, places, icon, action) => places.slice(0, MAX_PLACE_BUTTONS)
  .map((p) => postbackItem(`${icon} ${p.name}`, tripPb(action, trip, `&p=${encodeURIComponent(p.id)}`), `${icon} ${p.name}`));

async function handleTripSubMenu(action, trip, params) {
  const placeId = params.get('p');
  const places = ['menu_trip_visit', 'menu_trip_visit_do', 'menu_trip_del', 'menu_trip_del_ask', 'menu_trip_del_do'].includes(action)
    ? await getTripPlaces(trip.id) : [];
  const place = placeId ? places.find((p) => String(p.id) === placeId) : null;
  const toPlaces = postbackItem('← กลับ', tripPb('menu_trip_places', trip), `กลับ ที่เที่ยว`);

  switch (action) {
    case 'menu_trip_detail': return tripHub(trip);
    case 'menu_trip_notes': return notesMenu(trip);
    case 'menu_trip_places': return placesMenu(trip);

    case 'menu_trip_visit': {
      const pending = places.filter((p) => p.status !== 'visited');
      if (!pending.length) return placesMenu(trip, 'ไม่มีที่ที่ยังไม่ได้ไป\n\n');
      return withQuickReplies('เลือกที่ที่ไปแล้ว', [...placeButtons(trip, pending, '✓', 'menu_trip_visit_do'), toPlaces]);
    }
    case 'menu_trip_visit_do': {
      if (!place) return placesMenu(trip, 'ไม่พบที่นี้แล้ว\n\n');
      await markTripPlaceVisitedById(place.id);
      return placesMenu(trip, `✅ "${place.name}" บันทึกว่าไปแล้ว\n\n`);
    }

    case 'menu_trip_del':
      if (!places.length) return placesMenu(trip);
      return withQuickReplies('เลือกที่ที่จะลบออกจากทริป', [...placeButtons(trip, places, '🗑', 'menu_trip_del_ask'), toPlaces]);
    case 'menu_trip_del_ask':
      if (!place) return placesMenu(trip, 'ไม่พบที่นี้แล้ว\n\n');
      return withQuickReplies(`ลบ "${place.name}" ออกจากทริป ${trip.name} ใช่หรือไม่?`, [
        postbackItem('ใช่ ลบเลย', tripPb('menu_trip_del_do', trip, `&p=${encodeURIComponent(place.id)}`), `ลบ ${place.name}`),
        postbackItem('ไม่ลบ', tripPb('menu_trip_places', trip), 'ไม่ลบ'),
      ]);
    case 'menu_trip_del_do': {
      if (!place) return placesMenu(trip, 'ที่นี้ถูกลบไปแล้ว\n\n');
      await deleteTripPlaceById(place.id);
      return placesMenu(trip, `🗑 ลบ "${place.name}" ออกจากทริป ${trip.name} แล้ว\n\n`);
    }
    default: return null;
  }
}

async function handleMenuPostback(data, userContext = {}) {
  const params = new URLSearchParams(String(data || ''));
  const action = params.get('action') || '';

  if (action === 'menu_cancel') {
    clearMenuState(userContext.lineUserId || 'unknown');
    return { type: 'text', text: 'โอเค ไม่ทำอะไรต่อ 👍\nแตะเมนูด้านล่างได้เสมอเมื่อต้องการ' };
  }

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

  if (action.startsWith('menu_trip_')) {
    const trip = (await getTrips()).find((t) => String(t.id) === params.get('id'));
    if (!trip) return { type: 'text', text: 'ไม่พบทริปนี้แล้ว (อาจถูกลบ) แตะ ทริป ในเมนูเพื่อเลือกใหม่' };
    return handleTripSubMenu(action, trip, params);
  }

  if (action === 'menu_ask') {
    return withQuickReplies('💬 ถามได้เลย หรือพิมพ์คำถามเองก็ได้ เช่น "เดือนนี้กินกาแฟไปเท่าไหร่"', [
      ...Object.keys(MENU_QUESTIONS).map((q) => sayItem(q)),
    ]);
  }

  if (action === 'menu_notify') {
    return withQuickReplies('⏰ แจ้งเตือน\nตั้งแบบเลือกจากปฏิทิน หรือพิมพ์เอง เช่น เตือนพรุ่งนี้บ่ายสาม ซื้อนม', [
      sayItem('⏰ ตั้งแจ้งเตือนใหม่', 'แจ้งเตือนใหม่'),
      sayItem('📋 ดูแจ้งเตือน', 'ดูแจ้งเตือน'),
    ]);
  }

  // งาน (To-Do ร่วมกัน) / วันสำคัญ: แสดงลิสต์จริง + ปุ่มจัดการจากคำสั่งเดิม + ปุ่มเปิดคีย์บอร์ดเพิ่มรายการ
  if (action === 'menu_events') {
    return withQuickReplies('🎉 วันสำคัญ & 🎁 ของขวัญ\nวันสำคัญเตือนทุกปี และก่อนวันสำคัญของแฟน บอตจะแอบบอก wishlist ให้', [
      postbackItem('📅 ดูวันสำคัญ', 'action=menu_events_list', 'วันสำคัญ'),
      fillItem('➕ เพิ่มวันสำคัญ', 'เพิ่มวันสำคัญ '),
      sayItem('🎁 ของขวัญแฟน', 'ของขวัญแฟน'),
      sayItem('✨ ของที่ฉันอยากได้', 'ของที่อยากได้'),
      fillItem('➕ อยากได้…', 'อยากได้ '),
      fillItem('🎀 ให้ของขวัญแฟน', 'ให้ของขวัญแฟน '),
      sayItem('📜 ประวัติของขวัญ', 'ประวัติของขวัญ'),
    ]);
  }

  if (action === 'menu_todo' || action === 'menu_events_list') {
    const todo = action === 'menu_todo';
    const result = await (todo ? handleListTodos : handleListEvents)(userContext.lineUserId || 'unknown');
    const add = todo ? fillItem('➕ เพิ่มงาน', 'เพิ่มงาน ') : fillItem('➕ เพิ่มวันสำคัญ', 'เพิ่มวันสำคัญ ');
    return withQuickReplies(result.reply, [add, ...(result.quickReplies || []).slice(0, MAX_QUICK_REPLIES - 2).map((q) => sayItem(q.label, q.text))]);
  }

  if (action === 'menu_restaurant') {
    const all = await listRestaurants().catch(() => []); // ยังไม่รัน migration_013 → ถือว่ายังไม่มีร้าน (คำสั่งจะบอกเอง)
    const left = all.filter((r) => !r.visitedAt).length;
    const status = all.length ? `ในลิสต์ ${all.length} ร้าน (ยังไม่ได้ไป ${left})` : 'ยังไม่มีร้านในลิสต์';
    return withQuickReplies(`🍽 ร้านอาหาร\n${status}\nเพิ่มร้าน: แตะ ➕ แล้ววางลิงก์ Google Maps ต่อท้าย`, [
      sayItem('🎲 สุ่มร้าน', 'สุ่มร้าน'),
      fillItem('➕ เพิ่มร้าน', 'เพิ่มร้าน '),
      sayItem('📋 ร้านทั้งหมด', 'ร้านอาหาร'),
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
