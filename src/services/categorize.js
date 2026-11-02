// จัดหมวดค่าใช้จ่ายที่กฎ keyword จัดไม่ได้ (category = other) ด้วย Claude — ชั้นสำรองของ utils/categories.js
// โมเดลเลือกได้เฉพาะ key ใน whitelist และเห็นแค่ชื่อรายการ (ไม่เห็นยอด/ชื่อคน); ไม่แน่ใจให้ตอบ other
// ล้มเหลว/ไม่มี API key = ข้ามเงียบๆ ไม่กระทบการใช้งาน
const Anthropic = require('@anthropic-ai/sdk');
const { getExpenses, setExpenseCategory } = require('./db');
const { CATEGORY_KEYS, CATEGORIES, classifyByRules } = require('../utils/categories');

const MODEL = process.env.NL_MODEL || 'claude-haiku-5-5';
const TIMEOUT_MS = 8000;
const BATCH = 30;

const client = process.env.ANTHROPIC_API_KEY ? new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY }) : null;

const TOOL = {
  name: 'assign_categories',
  description: 'จัดหมวดค่าใช้จ่ายแต่ละรายการ',
  input_schema: {
    type: 'object',
    properties: {
      assignments: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            n: { type: 'integer', description: 'หมายเลขรายการตามที่ให้มา' },
            category: { type: 'string', enum: CATEGORY_KEYS },
          },
          required: ['n', 'category'],
        },
      },
    },
    required: ['assignments'],
  },
};

async function callClaude(descriptions) {
  const system = [
    'จัดหมวดค่าใช้จ่ายของคู่รักชาวไทยตามชื่อรายการ',
    `หมวดที่ใช้ได้: ${CATEGORIES.map((c) => `${c.key} (${c.label})`).join(', ')}`,
    'ถ้าไม่แน่ใจจริงๆ ให้ใช้ other — อย่าเดา',
  ].join('\n');
  const response = await client.messages.create({
    model: MODEL,
    max_tokens: 600,
    system,
    tools: [TOOL],
    tool_choice: { type: 'tool', name: TOOL.name },
    messages: [{ role: 'user', content: descriptions.map((d, i) => `${i + 1}. ${d}`).join('\n') }],
  }, { timeout: TIMEOUT_MS });
  return response.content.find((b) => b.type === 'tool_use')?.input?.assignments || [];
}

let classifier = callClaude;
function __setClassifier(fn) { classifier = fn || callClaude; }

const attempted = new Set(); // รายการที่ถามโมเดลไปแล้ว (ตอบ other ก็ไม่ถามซ้ำในรอบโปรเซสนี้)
function __resetAttempted() { attempted.clear(); }

const available = () => Boolean(client) || classifier !== callClaude;

// ลำดับ: กฎ keyword ก่อน (ฟรี ครอบรายการเก่าที่ยังเป็น other) → ที่เหลือค่อยถามโมเดล
// คืน { classified, byRules, remaining, skipped } — skipped = true ถ้าโมเดลใช้ไม่ได้ (กฎยังทำงาน)
async function classifyPending({ limit = BATCH } = {}) {
  const all = await getExpenses();
  const pending = all.filter((e) => (e.category || 'other') === 'other' && !attempted.has(e.id));

  let byRules = 0;
  const unknown = [];
  for (const e of pending) {
    const key = classifyByRules(e.description);
    if (key !== 'other') {
      await setExpenseCategory(e.id, key);
      byRules += 1;
    } else {
      unknown.push(e);
    }
  }
  const batch = unknown.slice(-limit);
  if (!batch.length) return { classified: byRules, byRules, remaining: 0, skipped: false };
  if (!available()) return { classified: byRules, byRules, remaining: unknown.length, skipped: true };

  let assignments;
  try {
    assignments = await classifier(batch.map((e) => String(e.description || '').slice(0, 80)));
  } catch (error) {
    console.error('CATEGORIZE_FAILED', error?.message || error);
    return { classified: byRules, byRules, remaining: unknown.length, skipped: true };
  }

  let byModel = 0;
  for (const e of batch) attempted.add(e.id);
  for (const a of assignments || []) {
    const e = batch[Number(a.n) - 1];
    if (!e || !CATEGORY_KEYS.includes(a.category) || a.category === 'other') continue;
    await setExpenseCategory(e.id, a.category);
    byModel += 1;
  }
  return { classified: byRules + byModel, byRules, remaining: unknown.length - byModel, skipped: false };
}

module.exports = { classifyPending, __setClassifier, __resetAttempted };
