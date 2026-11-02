// รายงานค่าใช้จ่ายของทริป (แสดงทุกรายการ ทั้งที่เคลียร์แล้วและยังไม่เคลียร์) — คำนวณด้วยโค้ดล้วน
// ใช้กับ "สรุปทริป" และสถิติสั้นๆ ในรายการทริป/เมนูทริป เพื่อดูทริปเก่าที่ปิดแล้วได้ว่าจ่ายอะไรไปบ้าง
const { categoryLabel } = require('./categories');
const { MONTH_LABELS } = require('./parse-date');
const { localToday } = require('./planner-dates');

const fmt = (n) => Number(n).toLocaleString('th-TH', { maximumFractionDigits: 2 });
const sum = (list) => list.reduce((s, e) => s + Number(e.amount || 0), 0);

function shortDate(iso) {
  if (!iso) return '';
  const t = localToday(new Date(iso));
  return `${t.d} ${MONTH_LABELS[t.m]}`;
}

// ยอดรวม + จำนวนรายการของทริป (ใช้ในรายการทริป / เมนูทริป)
function tripStats(expenses) {
  return { total: sum(expenses), count: expenses.length };
}

const statsLabel = ({ total, count }) => (count ? `ใช้จ่ายรวม ${fmt(total)} บาท (${count} รายการ)` : 'ยังไม่มีรายการ');

// คืนบรรทัดของรายงาน: หัว · ยอดรวม · ตามคนจ่าย · ตามหมวด · รายการทั้งหมด (จำกัดความยาวไม่ให้เกินขีดจำกัดข้อความของ LINE)
function buildTripReport({ trip, expenses, users = [], maxChars = 3600 }) {
  const nameById = Object.fromEntries(users.map((u) => [String(u.id), u.displayName]));
  const payerName = (e) => nameById[String(e.paidByUserId)] || '?';
  const items = [...expenses].sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt)));

  const first = shortDate(items[0].createdAt);
  const last = shortDate(items.at(-1).createdAt);
  const when = first === last ? first : `${first} – ${last}`;
  const lines = [
    `📊 สรุปทริป "${trip.name}"${trip.is_billable === true ? ' (ปิดทริปแล้ว)' : ' (ยังไม่ปิดทริป)'}`,
    `💰 ใช้จ่ายรวม ${fmt(sum(items))} บาท · ${items.length} รายการ${when ? ` · ${when}` : ''}`,
  ];

  const byPayer = {};
  for (const e of items) byPayer[payerName(e)] = (byPayer[payerName(e)] || 0) + Number(e.amount || 0);
  lines.push(`👤 ${Object.entries(byPayer).map(([n, v]) => `${n} จ่ายไป ${fmt(v)}`).join(' · ')}`);

  const byCategory = {};
  for (const e of items) byCategory[e.category || 'other'] = (byCategory[e.category || 'other'] || 0) + Number(e.amount || 0);
  const cats = Object.entries(byCategory).sort((a, b) => b[1] - a[1]);
  if (cats.length > 1 || (cats.length === 1 && cats[0][0] !== 'other')) {
    const total = sum(items) || 1;
    lines.push('', '🏷 แยกหมวด', ...cats.map(([key, v]) => `• ${categoryLabel(key)} ${fmt(v)} บาท (${Math.round((v / total) * 100)}%)`));
  }

  lines.push('', '📋 รายการทั้งหมด (✓ = เคลียร์แล้ว)');
  let used = lines.join('\n').length;
  let shown = 0;
  for (const e of items) {
    const line = `• ${shortDate(e.createdAt)} ${e.description} ${fmt(e.amount)} บาท (${payerName(e)})${e.splitMode === 'none' ? ' · ส่วนตัว' : ''}${e.isCleared ? ' ✓' : ''}`;
    if (used + line.length + 1 > maxChars) break;
    lines.push(line);
    used += line.length + 1;
    shown += 1;
  }
  if (shown < items.length) {
    const rest = items.slice(shown);
    lines.push(`… และอีก ${rest.length} รายการ (รวม ${fmt(sum(rest))} บาท)`);
  }
  return lines;
}

module.exports = { buildTripReport, tripStats, statsLabel, fmt };
