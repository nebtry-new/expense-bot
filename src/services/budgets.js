// งบรายเดือนต่อหมวด: สถานะการใช้งบ + แจ้งเตือนตอนบันทึกรายการที่ทำให้ใกล้เต็ม/เกินงบ
const { getExpenses, listCategoryBudgets } = require('./db');
const { categoryLabel } = require('../utils/categories');
const { sameThaiMonth } = require('../utils/month');

const WARN_RATIO = 0.8;
const fmt = (n) => Number(n).toLocaleString();

// ยอดรวมต่อหมวดของเดือนที่ date อยู่ (เวลาไทย) — นับยอดเต็มของรายการ (งบของทั้งคู่ร่วมกัน)
function totalsByCategory(expenses, date) {
  const totals = {};
  for (const e of expenses) {
    if (!e.createdAt || !sameThaiMonth(e.createdAt, date)) continue;
    const key = e.category || 'other';
    totals[key] = (totals[key] || 0) + Number(e.amount || 0);
  }
  return totals;
}

// savedItems: ผลจาก addExpense (ต้องมี amount, category, createdAt/created_at)
// คืนข้อความเตือน (array) เฉพาะหมวดที่ "เพิ่งข้าม" 80% หรือ 100% ในรายการที่เพิ่งบันทึก — ไม่เตือนซ้ำทุกรายการ
async function budgetAlerts(savedItems) {
  try {
    const items = (savedItems || []).filter(Boolean);
    if (!items.length) return [];
    const budgets = await listCategoryBudgets();
    if (!Object.keys(budgets).length) return [];

    const expenses = await getExpenses();
    const lines = [];
    const cats = [...new Set(items.map((i) => i.category || 'other'))];
    for (const cat of cats) {
      const limit = budgets[cat];
      if (!limit) continue;
      const mine = items.filter((i) => (i.category || 'other') === cat);
      const when = mine[0].createdAt || mine[0].created_at || new Date();
      const added = mine
        .filter((i) => sameThaiMonth(i.createdAt || i.created_at || when, when))
        .reduce((sum, i) => sum + Number(i.amount || 0), 0);
      const total = totalsByCategory(expenses, when)[cat] || 0;
      const before = total - added;

      if (before < limit && total >= limit) {
        lines.push(`🚨 หมวด${categoryLabel(cat)} เกินงบเดือนนี้แล้ว: ใช้ ${fmt(total)} / งบ ${fmt(limit)} บาท (เกิน ${fmt(total - limit)})`);
      } else if (before < limit * WARN_RATIO && total >= limit * WARN_RATIO && total < limit) {
        lines.push(`⚠️ หมวด${categoryLabel(cat)} ใกล้เต็มงบแล้ว: ใช้ ${fmt(total)} / งบ ${fmt(limit)} บาท (เหลือ ${fmt(limit - total)})`);
      }
    }
    return lines;
  } catch (error) {
    console.error('BUDGET_ALERT_FAILED', error?.message || error);
    return [];
  }
}

// ต่อข้อความเตือนท้ายคำตอบ
const withAlerts = (reply, alerts) => (alerts.length ? `${reply}\n\n${alerts.join('\n')}` : reply);

module.exports = { totalsByCategory, budgetAlerts, withAlerts, WARN_RATIO };
