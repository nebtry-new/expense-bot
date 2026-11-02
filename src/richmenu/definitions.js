// Rich menu 2 แท็บ (หน้าหลัก / เพิ่มเติม) — ขนาดเต็ม 2500×1686
// แถบแท็บสูง TAB_H ด้านบน แล้วกริด 3 คอลัมน์ × 2 แถวด้านล่าง
// ทุกปุ่มส่งเข้า flow เดิมของบอต (ข้อความคำสั่ง / postback action=menu_*) ไม่มี logic ซ้ำในเมนู
const WIDTH = 2500;
const HEIGHT = 1686;
const TAB_H = 150;
const ROW_H = (HEIGHT - TAB_H) / 2; // 768
const COL_W = [833, 834, 833];

const NAME_PREFIX = 'expense-bot:';
const ALIAS_MAIN = 'expense-bot-main';
const ALIAS_MORE = 'expense-bot-more';
const CHAT_BAR_TEXT = 'เมนู';

const msg = (label, text) => ({ type: 'message', label, text });
const post = (label, data, extra = {}) => ({ type: 'postback', label, data, ...extra });
const fillIn = (label, data, fillInText) => post(label, data, { inputOption: 'openKeyboard', fillInText });

// ปุ่มเรียงตามตำแหน่งกริด: [บนซ้าย, บนกลาง, บนขวา, ล่างซ้าย, ล่างกลาง, ล่างขวา]
const BUTTONS = {
  main: [
    { key: 'record', title: '💸 บันทึกค่าใช้จ่าย', action: fillIn('บันทึกค่าใช้จ่าย', 'action=menu_record', 'ค่า') },
    { key: 'summary', title: '📊 สรุปยอด', action: msg('สรุปยอด', 'สรุป') },
    { key: 'money', title: '💳 จ่าย/รับเงิน', action: post('จ่าย/รับเงิน', 'action=menu_money') },
    { key: 'delete', title: '🗑 ลบรายการ', action: msg('ลบรายการ', 'ลบรายการ') },
    { key: 'trip', title: '✈️ ทริป', action: post('ทริป', 'action=menu_trip') },
    { key: 'ask', title: '💬 ถามข้อมูล', action: post('ถามข้อมูล', 'action=menu_ask') },
  ],
  more: [
    { key: 'notify', title: '⏰ แจ้งเตือน', action: post('แจ้งเตือน', 'action=menu_notify') },
    { key: 'todo', title: '📋 งาน', action: post('งาน', 'action=menu_todo') },
    { key: 'events', title: '🎉 วันสำคัญ', action: post('วันสำคัญ', 'action=menu_events') },
    { key: 'ev', title: '🔌 หาจุดชาร์จ EV', action: post('หาจุดชาร์จ EV', 'action=menu_ev') },
    { key: 'restaurant', title: '🍽 ร้านอาหาร', action: post('ร้านอาหาร', 'action=menu_restaurant') },
    { key: 'help', title: '❓ วิธีใช้', action: msg('วิธีใช้', 'help') },
  ],
};

const TAB_TITLES = { main: 'หน้าหลัก', more: 'เพิ่มเติม' };

function gridAreas(buttons) {
  const areas = [];
  buttons.forEach((button, i) => {
    const row = Math.floor(i / 3);
    const col = i % 3;
    const x = COL_W.slice(0, col).reduce((a, b) => a + b, 0);
    areas.push({
      bounds: { x, y: TAB_H + row * ROW_H, width: COL_W[col], height: ROW_H },
      action: button.action,
    });
  });
  return areas;
}

function tabAreas() {
  const half = WIDTH / 2;
  return [
    { bounds: { x: 0, y: 0, width: half, height: TAB_H }, action: { type: 'richmenuswitch', richMenuAliasId: ALIAS_MAIN, data: 'action=tab_main' } },
    { bounds: { x: half, y: 0, width: half, height: TAB_H }, action: { type: 'richmenuswitch', richMenuAliasId: ALIAS_MORE, data: 'action=tab_more' } },
  ];
}

function buildMenu(tab) {
  return {
    size: { width: WIDTH, height: HEIGHT },
    selected: tab === 'main', // แท็บหลักเปิดอัตโนมัติ
    name: `${NAME_PREFIX}${tab}`,
    chatBarText: CHAT_BAR_TEXT,
    areas: [...tabAreas(), ...gridAreas(BUTTONS[tab])],
  };
}

// คืน { main, more } ตาม RichMenuRequest ของ LINE Messaging API
function buildRichMenus() {
  return { main: buildMenu('main'), more: buildMenu('more') };
}

module.exports = {
  buildRichMenus, BUTTONS, TAB_TITLES,
  WIDTH, HEIGHT, TAB_H, ROW_H, COL_W, NAME_PREFIX, ALIAS_MAIN, ALIAS_MORE, CHAT_BAR_TEXT,
};
