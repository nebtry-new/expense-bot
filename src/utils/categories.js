// หมวดค่าใช้จ่าย — เก็บ key (อังกฤษ) ลง expenses.category; label ใช้แสดงผล
// classifyByRules อ่านจากชื่อรายการด้วย keyword (โค้ดล้วน ไม่เรียกโมเดล) ถ้าไม่เจอคืน 'other' (ให้ชั้นโมเดลช่วยทีหลัง)
// ลำดับสำคัญ: keyword ที่เจาะจงกว่าต้องมาก่อน (เช่น "ค่าน้ำมัน" ต้องเข้าเดินทางก่อนที่ "ค่าน้ำ" จะเข้าบิล)
const CATEGORIES = [
  { key: 'transport', label: '🚗 เดินทาง', aliases: ['เดินทาง', 'รถ'], keywords: ['น้ำมัน', 'แท็กซี่', 'taxi', 'grab', 'bolt', 'รถเมล์', 'รถไฟ', 'bts', 'mrt', 'ทางด่วน', 'ค่าจอด', 'จอดรถ', 'ค่ารถ', 'ชาร์จรถ', 'ค่าชาร์จ', 'ค่าเดินทาง', 'มอเตอร์ไซค์', 'วินมอ', 'ค่าทางด่วน'] },
  { key: 'bills', label: '🏠 บ้าน/บิล', aliases: ['บ้าน', 'บิล', 'ค่าบิล'], keywords: ['ค่าไฟ', 'ค่าน้ำ', 'ค่าเน็ต', 'อินเทอร์เน็ต', 'ค่าเช่า', 'ค่าห้อง', 'ค่าคอนโด', 'ส่วนกลาง', 'ค่าโทรศัพท์', 'ค่ามือถือ', 'ประกัน', 'ค่าแก๊ส', 'ค่างวด', 'ผ่อน'] },
  { key: 'food', label: '🍜 อาหาร', aliases: ['อาหาร', 'กิน', 'ของกิน'], keywords: ['ข้าว', 'อาหาร', 'ค่ากิน', 'กาแฟ', 'คาเฟ่', 'ชานม', 'ชาไข่มุก', 'ชาเขียว', 'ขนม', 'เค้ก', 'ไอติม', 'ไอศกรีม', 'หมูกระทะ', 'ชาบู', 'สุกี้', 'บุฟเฟ่', 'ปิ้งย่าง', 'ก๋วยเตี๋ยว', 'ส้มตำ', 'เครื่องดื่ม', 'เบียร์', 'เหล้า', 'ไวน์', 'พิซซ่า', 'ซูชิ', 'เดลิเวอรี', 'lineman', 'foodpanda', 'kfc', 'mcdonald', 'starbucks', 'อเมซอน', 'ผลไม้', 'ตลาด', 'ข้าวมัน', 'บะหมี่', 'โจ๊ก'] },
  { key: 'entertainment', label: '🎬 บันเทิง', aliases: ['บันเทิง', 'หนัง'], keywords: ['หนัง', 'ภาพยนตร์', 'netflix', 'spotify', 'youtube', 'เกม', 'คอนเสิร์ต', 'คาราโอเกะ', 'karaoke', 'สวนสนุก', 'พิพิธภัณฑ์', 'สมัครสมาชิก', 'subscription'] },
  { key: 'health', label: '💊 สุขภาพ', aliases: ['สุขภาพ', 'ยา'], keywords: ['ค่ายา', 'ซื้อยา', 'ร้านขายยา', 'หมอ', 'โรงพยาบาล', 'คลินิก', 'ทันตแพทย์', 'ฟัน', 'วิตามิน', 'ตรวจสุขภาพ', 'ฟิตเนส', 'ยิม', 'นวด', 'สปา'] },
  { key: 'travel', label: '✈️ ท่องเที่ยว/ที่พัก', aliases: ['ท่องเที่ยว', 'ที่พัก', 'เที่ยว'], keywords: ['โรงแรม', 'ที่พัก', 'รีสอร์ท', 'โฮสเทล', 'airbnb', 'agoda', 'booking', 'เครื่องบิน', 'ทัวร์', 'ค่าเข้า', 'วีซ่า'] },
  { key: 'gift', label: '🎁 ของขวัญ', aliases: ['ของขวัญ'], keywords: ['ของขวัญ', 'ดอกไม้', 'การ์ด', 'เซอร์ไพรส์'] },
  { key: 'shopping', label: '🛍 ช้อปปิ้ง', aliases: ['ช้อปปิ้ง', 'ช้อป', 'ของใช้'], keywords: ['ซื้อ', 'เสื้อ', 'กางเกง', 'รองเท้า', 'กระเป๋า', 'เครื่องสำอาง', 'ของใช้', 'shopee', 'lazada', 'เซเว่น', '7-11', 'โลตัส', 'บิ๊กซี', 'ท็อปส์', 'ห้าง', 'ช้อป', 'ซุปเปอร์'] },
  { key: 'other', label: '📦 อื่นๆ', aliases: ['อื่นๆ', 'อื่น'], keywords: [] },
];

const CATEGORY_KEYS = CATEGORIES.map((c) => c.key);
const byKey = Object.fromEntries(CATEGORIES.map((c) => [c.key, c]));

const categoryLabel = (key) => byKey[key]?.label || byKey.other.label;

function classifyByRules(description) {
  const text = String(description || '').toLowerCase();
  for (const c of CATEGORIES) {
    if (c.keywords.some((k) => text.includes(k))) return c.key;
  }
  return 'other';
}

// ชื่อหมวดที่ผู้ใช้พิมพ์ (อาหาร / เดินทาง / food …) → key; ไม่รู้จักคืน null
function resolveCategory(word) {
  const w = String(word || '').trim().toLowerCase().replace(/^[^\p{L}\p{N}]+/u, '');
  if (!w) return null;
  for (const c of CATEGORIES) {
    if (c.key === w || c.aliases.some((a) => a.toLowerCase() === w) || c.label.toLowerCase().endsWith(w)) return c.key;
  }
  return null;
}

module.exports = { CATEGORIES, CATEGORY_KEYS, categoryLabel, classifyByRules, resolveCategory };
