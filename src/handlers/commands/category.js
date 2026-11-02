// คำสั่งหมวด/งบ: จัดหมวด · ตั้งงบ [หมวด] [จำนวน] · ดูงบ · ลบงบ [หมวด]
const { listCategoryBudgets, setCategoryBudget, deleteCategoryBudget, getExpenses } = require('../../services/db');
const { classifyPending } = require('../../services/categorize');
const { totalsByCategory, WARN_RATIO } = require('../../services/budgets');
const { CATEGORIES, categoryLabel, resolveCategory } = require('../../utils/categories');

const fmt = (n) => Number(n).toLocaleString();
const categoryList = () => CATEGORIES.filter((c) => c.key !== 'other').map((c) => c.label).join(' · ');

async function handleCategorize() {
  const r = await classifyPending();
  if (!r.classified && !r.remaining) return { type: 'categorize', reply: 'ทุกรายการมีหมวดครบแล้ว 👍' };
  const lines = [`จัดหมวดแล้ว ${r.classified} รายการ`];
  if (r.byRules) lines.push(`• จากคำสำคัญ ${r.byRules} รายการ`);
  if (r.classified - r.byRules > 0) lines.push(`• ให้ AI ช่วย ${r.classified - r.byRules} รายการ`);
  if (r.remaining) lines.push(`ยังไม่รู้หมวด ${r.remaining} รายการ (อยู่ในหมวด ${categoryLabel('other')})`);
  if (r.skipped) lines.push('(AI ใช้ไม่ได้ตอนนี้ จัดได้เฉพาะที่ตรงกับคำสำคัญ)');
  return { type: 'categorize', reply: lines.join('\n') };
}

const RETRY_BUDGET = [{ label: '➕ ลองใหม่', fillIn: 'ตั้งงบ ' }];

async function handleSetBudget(args) {
  const m = String(args || '').trim().match(/^(.+?)\s+([\d,]+(?:\.\d+)?)\s*(?:บาท)?$/);
  if (!m) return { type: 'error', reply: `รูปแบบ: ตั้งงบ [หมวด] [จำนวนต่อเดือน] เช่น ตั้งงบ อาหาร 5000\nหมวด: ${categoryList()}`, quickReplies: RETRY_BUDGET };
  const key = resolveCategory(m[1]);
  if (!key || key === 'other') return { type: 'error', reply: `ไม่รู้จักหมวด "${m[1]}"\nหมวดที่ตั้งงบได้: ${categoryList()}`, quickReplies: RETRY_BUDGET };
  const limit = Number(m[2].replace(/,/g, ''));
  if (!(limit > 0)) return { type: 'error', reply: 'งบต้องมากกว่า 0', quickReplies: RETRY_BUDGET };
  await setCategoryBudget(key, limit);
  return {
    type: 'budget_set',
    reply: `ตั้งงบหมวด${categoryLabel(key)} เดือนละ ${fmt(limit)} บาทแล้ว\nบอตจะเตือนเมื่อใช้ถึง ${Math.round(WARN_RATIO * 100)}% และเมื่อเกินงบ`,
    quickReplies: [{ label: '➕ ตั้งงบอีก', fillIn: 'ตั้งงบ ' }, { label: '💰 ดูงบ', text: 'ดูงบ' }],
  };
}

async function handleShowBudgets() {
  const budgets = await listCategoryBudgets();
  const keys = Object.keys(budgets);
  if (!keys.length) {
    return { type: 'budgets', reply: `ยังไม่ได้ตั้งงบ\nตั้งได้ด้วย: ตั้งงบ [หมวด] [จำนวน] เช่น ตั้งงบ อาหาร 5000\nหมวด: ${categoryList()}` };
  }
  const totals = totalsByCategory(await getExpenses(), new Date());
  const lines = ['💰 งบเดือนนี้\n', ...keys.map((k) => budgetLine(k, totals[k] || 0, budgets[k]))];
  return {
    type: 'budgets',
    reply: lines.join('\n'),
    quickReplies: keys.map((k) => ({ label: `ลบงบ ${categoryLabel(k).replace(/^\S+\s/, '')}`, text: `ลบงบ ${categoryLabel(k).replace(/^\S+\s/, '')}` })),
  };
}

function budgetLine(key, used, limit) {
  const pct = Math.round((used / limit) * 100);
  const flag = used >= limit ? ' 🚨 เกินงบ' : used >= limit * WARN_RATIO ? ' ⚠️ ใกล้เต็ม' : '';
  return `${categoryLabel(key)}: ${fmt(used)} / ${fmt(limit)} บาท (${pct}%)${flag}`;
}

async function handleDeleteBudget(arg) {
  const key = resolveCategory(arg);
  if (!key) return { type: 'error', reply: `ไม่รู้จักหมวด "${arg}" ลองพิมพ์ ดูงบ เพื่อดูหมวดที่ตั้งไว้` };
  const ok = await deleteCategoryBudget(key);
  return ok
    ? { type: 'budget_deleted', reply: `ลบงบหมวด${categoryLabel(key)} แล้ว` }
    : { type: 'noop', reply: `หมวด${categoryLabel(key)} ยังไม่ได้ตั้งงบ` };
}

module.exports = { handleCategorize, handleSetBudget, handleShowBudgets, handleDeleteBudget, budgetLine };
