// ตอบคำถามเกี่ยวกับค่าใช้จ่าย (อ่านอย่างเดียว) — ตัวเลขทุกตัวคำนวณด้วยโค้ดจากข้อมูลจริง ไม่ให้โมเดลคิดเลขเอง
// โมเดลมีหน้าที่แค่แปลงคำถามเป็น { kind, period, keywords, payer, trip_name, limit }
const { calculateBalances } = require('../utils/balance');
const { selectBillableExpenses, summarizePendingTrips } = require('../utils/billing');

const KINDS = ['total', 'balance', 'recent', 'trip_total'];
const PERIODS = ['today', 'yesterday', 'this_week', 'last_week', 'this_month', 'last_month', 'this_year', 'all'];

const TZ_OFFSET_MS = 7 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;
const MONTH_LABELS = ['', 'ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.', 'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.'];
const PERIOD_LABELS = {
  today: 'วันนี้', yesterday: 'เมื่อวาน', this_week: 'สัปดาห์นี้', last_week: 'สัปดาห์ที่แล้ว',
  this_month: 'เดือนนี้', last_month: 'เดือนที่แล้ว', this_year: 'ปีนี้', all: 'ทั้งหมด',
};

const fmt = (n) => Number(n).toLocaleString('th-TH', { maximumFractionDigits: 2 });

// ช่วงเวลา [start, end) เป็น UTC ตามวันเวลาไทย; null = ไม่จำกัด
function periodRange(period, now = new Date()) {
  const l = new Date(now.getTime() + TZ_OFFSET_MS);
  const y = l.getUTCFullYear();
  const m = l.getUTCMonth();
  const d = l.getUTCDate();
  const startOfDay = Date.UTC(y, m, d) - TZ_OFFSET_MS;
  const mondayOffset = (l.getUTCDay() + 6) % 7; // จันทร์ = 0

  switch (period) {
    case 'today': return [startOfDay, startOfDay + DAY_MS];
    case 'yesterday': return [startOfDay - DAY_MS, startOfDay];
    case 'this_week': return [startOfDay - mondayOffset * DAY_MS, startOfDay - mondayOffset * DAY_MS + 7 * DAY_MS];
    case 'last_week': return [startOfDay - (mondayOffset + 7) * DAY_MS, startOfDay - mondayOffset * DAY_MS];
    case 'this_month': return [Date.UTC(y, m, 1) - TZ_OFFSET_MS, Date.UTC(y, m + 1, 1) - TZ_OFFSET_MS];
    case 'last_month': return [Date.UTC(y, m - 1, 1) - TZ_OFFSET_MS, Date.UTC(y, m, 1) - TZ_OFFSET_MS];
    case 'this_year': return [Date.UTC(y, 0, 1) - TZ_OFFSET_MS, Date.UTC(y + 1, 0, 1) - TZ_OFFSET_MS];
    default: return null;
  }
}

function shortDate(iso) {
  const l = new Date(new Date(iso).getTime() + TZ_OFFSET_MS);
  return `${l.getUTCDate()} ${MONTH_LABELS[l.getUTCMonth() + 1]}`;
}

// คืนข้อความตอบ หรือ { error }
function answerQuestion(q, { expenses = [], users = [], trips = [], sender = null, now = new Date() } = {}) {
  if (!KINDS.includes(q?.kind)) return { error: 'bad_kind' };

  const nameById = Object.fromEntries(users.map((u) => [String(u.id), u.displayName]));
  const payerName = (e) => nameById[String(e.paidByUserId)] || '?';

  if (q.kind === 'balance') return { reply: answerBalance(expenses, users, trips) };

  if (q.kind === 'trip_total') {
    const trip = trips.find((t) => (t.name || '').toLowerCase() === String(q.trip_name || '').toLowerCase());
    if (!trip) return { reply: `ไม่พบทริป "${q.trip_name || ''}"` };
    const items = expenses.filter((e) => e.tripId === trip.id);
    if (!items.length) return { reply: `ทริป "${trip.name}" ยังไม่มีค่าใช้จ่าย` };
    const total = items.reduce((s, e) => s + Number(e.amount), 0);
    const lines = [`ทริป "${trip.name}": รวม ${fmt(total)} บาท (${items.length} รายการ)`, ...perPayerLines(items, payerName)];
    const open = items.filter((e) => !e.isCleared);
    if (open.length && users.length === 2) lines.push(balanceSentence(calculateBalances(open, users), users) || 'ยอดทริปนี้หักลบกันพอดี');
    return { reply: lines.join('\n') };
  }

  // total / recent: กรองตามช่วงเวลา คำค้น คนจ่าย ทริป
  const period = PERIODS.includes(q.period) ? q.period : (q.kind === 'recent' ? 'all' : 'this_month');
  const range = periodRange(period, now);
  const keywords = (Array.isArray(q.keywords) ? q.keywords : []).map((k) => String(k).trim().toLowerCase()).filter(Boolean);
  const tripFilter = q.trip_name
    ? trips.find((t) => (t.name || '').toLowerCase() === String(q.trip_name).toLowerCase())
    : null;
  if (q.trip_name && !tripFilter) return { reply: `ไม่พบทริป "${q.trip_name}"` };

  const senderId = sender ? String(sender.id) : null;
  const items = expenses.filter((e) => {
    const at = new Date(e.createdAt).getTime();
    if (range && !(at >= range[0] && at < range[1])) return false;
    if (keywords.length && !keywords.some((k) => String(e.description || '').toLowerCase().includes(k))) return false;
    if (tripFilter && e.tripId !== tripFilter.id) return false;
    if (q.payer === 'me' && senderId && String(e.paidByUserId) !== senderId) return false;
    if (q.payer === 'partner' && senderId && String(e.paidByUserId) === senderId) return false;
    return true;
  });

  const scope = [PERIOD_LABELS[period], keywords.length ? `"${keywords.join('/')}"` : null, tripFilter ? `ทริป ${tripFilter.name}` : null]
    .filter(Boolean).join(' · ');
  if (!items.length) return { reply: `ไม่พบรายการ (${scope})` };

  if (q.kind === 'recent') {
    const limit = Math.min(Math.max(Number.parseInt(q.limit, 10) || 5, 1), 10);
    const latest = [...items].sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt)).slice(0, limit);
    const lines = latest.map((e, i) => `${i + 1}. ${shortDate(e.createdAt)} ${e.description} ${fmt(e.amount)} บาท (${payerName(e)} จ่าย)`);
    return { reply: [`รายการล่าสุด (${scope}):`, ...lines].join('\n') };
  }

  const total = items.reduce((s, e) => s + Number(e.amount), 0);
  const top = [...items].sort((a, b) => Number(b.amount) - Number(a.amount)).slice(0, 5);
  const lines = [
    `${scope}: รวม ${fmt(total)} บาท (${items.length} รายการ)`,
    ...perPayerLines(items, payerName),
    '',
    'มากสุด:',
    ...top.map((e) => `• ${e.description} ${fmt(e.amount)} บาท (${shortDate(e.createdAt)})`),
  ];
  return { reply: lines.join('\n') };
}

function perPayerLines(items, payerName) {
  const byPayer = {};
  for (const e of items) byPayer[payerName(e)] = (byPayer[payerName(e)] || 0) + Number(e.amount);
  return Object.entries(byPayer).map(([name, sum]) => `${name} จ่ายไป ${fmt(sum)} บาท`);
}

function balanceSentence(balances, users) {
  if (users.length !== 2) return null;
  const [a, b] = users;
  const balA = Number(balances[String(a.id)] ?? 0);
  const balB = Number(balances[String(b.id)] ?? 0);
  if (Math.abs(balA) < 0.005 && Math.abs(balB) < 0.005) return null;
  return balA >= 0
    ? `${b.displayName} ต้องจ่ายให้ ${a.displayName} ${fmt(Math.abs(balB))} บาท`
    : `${a.displayName} ต้องจ่ายให้ ${b.displayName} ${fmt(Math.abs(balA))} บาท`;
}

function answerBalance(expenses, users, trips) {
  if (users.length < 2) return 'ยังมีผู้ใช้ไม่ครบ 2 คน';
  const billable = selectBillableExpenses(expenses, trips);
  const sentence = balanceSentence(calculateBalances(billable, users), users);
  const pending = summarizePendingTrips(expenses, trips);
  const lines = [sentence || 'ตอนนี้ไม่มียอดค้างจ่าย'];
  if (pending.length) {
    lines.push('', 'ทริปที่ยังไม่เรียกเก็บ (ไม่รวมในยอด):', ...pending.map((t) => `• ${t.name} ${fmt(t.total)} บาท`));
  }
  return lines.join('\n');
}

module.exports = { answerQuestion, periodRange, KINDS, PERIODS };
