const Anthropic = require('@anthropic-ai/sdk');

const MODEL = process.env.NL_MODEL || 'claude-haiku-5-5';
const TIMEOUT_MS = 8000;
const MAX_TEXT_LENGTH = 300;
const RATE_LIMIT = { max: 10, windowMs: 60 * 1000 };
const MIN_CONFIDENCE = 0.6;

const client = process.env.ANTHROPIC_API_KEY
  ? new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
  : null;

const callsByUser = {};

const EXPENSE_TOOL = {
  name: 'record_expenses',
  description: 'บันทึกรายการค่าใช้จ่ายที่ผู้ใช้พิมพ์มา ถ้าข้อความไม่ใช่การบันทึกค่าใช้จ่ายหรือจำนวนเงินไม่ชัดเจน ให้ intent เป็น unknown',
  input_schema: {
    type: 'object',
    properties: {
      intent: { type: 'string', enum: ['add_expense', 'unknown'] },
      confidence: { type: 'number', description: '0-1 ความมั่นใจว่าตีความถูก' },
      expenses: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            description: { type: 'string', description: 'ชื่อรายการสั้นๆ เช่น ค่าข้าว' },
            amount: { type: 'number', description: 'ยอดรวมเป็นบาท ต้องมาจากตัวเลขที่ปรากฏในข้อความเท่านั้น' },
            payer: { type: 'string', enum: ['me', 'partner'], description: 'ใครจ่ายเงินก่อน (me = คนที่ส่งข้อความ)' },
            split: { type: 'string', enum: ['half', 'none', 'per_head', 'custom'] },
            num_people: { type: 'integer', description: 'ใช้เฉพาะ per_head' },
            my_share: { type: 'number', description: 'ใช้เฉพาะ custom: ส่วนของคนส่งข้อความ' },
            partner_share: { type: 'number', description: 'ใช้เฉพาะ custom: ส่วนของแฟน' },
            trip_name: { type: ['string', 'null'], description: 'ชื่อทริปจากรายการทริปที่มี หรือ null' },
          },
          required: ['description', 'amount', 'payer', 'split'],
        },
      },
    },
    required: ['intent', 'confidence', 'expenses'],
  },
};

function buildSystemPrompt({ senderName, partnerName, tripNames }) {
  return [
    'คุณเป็นตัวแปลงข้อความภาษาไทยของคู่รักที่แชร์ค่าใช้จ่ายกัน ให้เรียก tool record_expenses เสมอ',
    `ผู้ส่งข้อความ = "me"${senderName ? ` (ชื่อ ${senderName})` : ''}, แฟน = "partner"${partnerName ? ` (ชื่อ ${partnerName})` : ''}`,
    `ทริปที่มีอยู่: ${tripNames.length ? tripNames.join(', ') : '(ไม่มี)'}`,
    '',
    'โหมดการแบ่งจ่าย (split):',
    '- half: หารครึ่ง (ค่าเริ่มต้นถ้าไม่ได้บอกอะไรเพิ่ม)',
    '- none: ส่วนตัว ไม่เอามาคิดเงินกับแฟน (คำใบ้: ส่วนตัว, ไม่หาร, ไม่ต้องหาร — ต้องบอกชัดเจน)',
    '- per_head: หารตามจำนวนคน (num_people ≥ 3)',
    '- custom: ระบุส่วนของแต่ละคน my_share + partner_share ต้องเท่ายอดรวม',
    '  - "ออกให้แฟน / เลี้ยงแฟน / จ่ายแทนแฟน" → payer=me, my_share=0, partner_share=ยอดรวม',
    '  - "แฟนออกให้ / แฟนเลี้ยง" → payer=partner, my_share=ยอดรวม, partner_share=0',
    '',
    'การยืมเงิน / ทดเงิน / สำรองจ่าย = อีกฝ่ายต้องคืนเต็มจำนวน (ไม่หารครึ่ง ใช้ split=custom):',
    '  - แฟนเป็นคนยืม: "แฟนยืม 500", "ให้แฟนยืม", "ทดให้แฟน", "สำรองจ่ายให้แฟน", "โอนให้แฟน" → payer=me, my_share=0, partner_share=ยอดรวม',
    '  - ผู้ส่งเป็นคนยืม: "ยืมแฟน 500", "ขอยืมตังแฟน", "แฟนให้ยืม", "แฟนทดให้", "แฟนโอนให้" → payer=partner, my_share=ยอดรวม, partner_share=0',
    '  - พิมพ์ว่า "ยืม 500" / "ยืมเงิน 500" โดยไม่ระบุว่าใคร → ถือว่าผู้ส่งเป็นคนยืมจากแฟน (payer=partner)',
    '  - description ใช้ "ยืมเงิน" หรือสิ่งที่ระบุ เช่น "ยืมค่าข้าว"',
    '',
    '- "ของขวัญ" ไม่ได้แปลว่า none: ถ้าไม่ได้บอกชัดว่าไม่หาร/ส่วนตัว/ออกให้แฟน ให้ใช้ half; ถ้าบอกว่าซื้อให้แฟนโดยไม่เอาเงิน (เช่น "ซื้อของขวัญให้แฟน 500 ไม่ต้องหาร") จึงใช้ none',
    'กฎ: amount ต้องมาจากตัวเลขในข้อความจริงเท่านั้น ห้ามเดา ถ้าไม่มีตัวเลขหรือไม่แน่ใจให้ intent=unknown',
    'ถ้าข้อความไม่ใช่การบันทึกค่าใช้จ่าย (ทักทาย, ถามคำถาม, สั่งงานอื่น) ให้ intent=unknown',
    'trip_name ใช้ได้เฉพาะชื่อที่อยู่ในรายการทริปด้านบน มิฉะนั้นใส่ null',
  ].join('\n');
}

async function callClaude(text, context) {
  const response = await client.messages.create({
    model: MODEL,
    max_tokens: 800,
    system: buildSystemPrompt(context),
    tools: [EXPENSE_TOOL],
    tool_choice: { type: 'tool', name: EXPENSE_TOOL.name },
    messages: [{ role: 'user', content: text }],
  }, { timeout: TIMEOUT_MS });

  const block = response.content.find((b) => b.type === 'tool_use');
  return block?.input || null;
}

let interpreter = callClaude;

// Test hook: replace the Claude call with a stub
function __setInterpreter(fn) {
  interpreter = fn || callClaude;
}

function isAvailable() {
  return Boolean(client) || interpreter !== callClaude;
}

function allowCall(userId) {
  const now = Date.now();
  const recent = (callsByUser[userId] || []).filter((t) => now - t < RATE_LIMIT.windowMs);
  if (recent.length >= RATE_LIMIT.max) {
    callsByUser[userId] = recent;
    return false;
  }
  recent.push(now);
  callsByUser[userId] = recent;
  return true;
}

// All numbers a user could mean in the text, incl. "1.5k", "2 พัน", "3 ร้อย"
function numbersInText(text) {
  const values = new Set();
  const cleaned = String(text).replace(/(\d),(?=\d{3}\b)/g, '$1');
  const multipliers = [['k', 1000], ['K', 1000], ['พัน', 1000], ['ร้อย', 100], ['หมื่น', 10000], ['แสน', 100000]];

  for (const m of cleaned.matchAll(/(\d+(?:\.\d+)?)\s*(k|K|พัน|ร้อย|หมื่น|แสน)?/g)) {
    const n = Number(m[1]);
    values.add(n);
    if (m[2]) values.add(Math.round(n * multipliers.find(([s]) => s === m[2])[1] * 100) / 100);
  }
  return values;
}

// Returns { ok: true, expenses } | { ok: false, reason }
function validateInterpretation(result, originalText) {
  if (!result || result.intent !== 'add_expense' || !Array.isArray(result.expenses) || !result.expenses.length) {
    return { ok: false, reason: 'unknown' };
  }
  if (Number(result.confidence) < MIN_CONFIDENCE) {
    return { ok: false, reason: 'low_confidence' };
  }

  const known = numbersInText(originalText);
  const expenses = [];

  for (const e of result.expenses) {
    const amount = Number(e.amount);
    if (!Number.isFinite(amount) || amount <= 0) return { ok: false, reason: 'bad_amount' };
    if (!known.has(amount)) return { ok: false, reason: 'amount_not_in_text' };

    const description = String(e.description || '').trim();
    if (!description) return { ok: false, reason: 'no_description' };

    const split = ['half', 'none', 'per_head', 'custom'].includes(e.split) ? e.split : null;
    if (!split) return { ok: false, reason: 'bad_split' };

    const payer = e.payer === 'partner' ? 'partner' : 'me';
    let numPeople = null;
    let myShare = null;
    let partnerShare = null;

    if (split === 'per_head') {
      numPeople = Number.parseInt(e.num_people, 10);
      if (!Number.isInteger(numPeople) || numPeople < 2) return { ok: false, reason: 'bad_num_people' };
    }
    if (split === 'custom') {
      myShare = Number(e.my_share);
      partnerShare = Number(e.partner_share);
      if (![myShare, partnerShare].every((v) => Number.isFinite(v) && v >= 0)
        || Math.abs(myShare + partnerShare - amount) > 0.01) {
        return { ok: false, reason: 'custom_sum_mismatch' };
      }
    }

    expenses.push({
      description,
      amount,
      payer,
      split: split === 'per_head' && numPeople === 2 ? 'half' : split,
      numPeople: split === 'per_head' && numPeople !== 2 ? numPeople : null,
      myShare,
      partnerShare,
      tripName: e.trip_name ? String(e.trip_name).trim() : null,
    });
  }

  return { ok: true, expenses };
}

// Returns { ok, expenses } | { ok: false, reason }. Never throws.
async function interpretExpenseMessage(text, context, userId = 'unknown') {
  const trimmed = String(text || '').trim();
  if (!isAvailable()) return { ok: false, reason: 'not_configured' };
  if (!trimmed || trimmed.length > MAX_TEXT_LENGTH) return { ok: false, reason: 'bad_length' };
  if (!allowCall(userId)) return { ok: false, reason: 'rate_limited' };

  try {
    const result = await interpreter(trimmed, { tripNames: [], ...context });
    return validateInterpretation(result, trimmed);
  } catch (err) {
    console.error('NL_INTERPRET_FAILED', err?.message || err);
    return { ok: false, reason: 'api_error' };
  }
}

module.exports = { interpretExpenseMessage, validateInterpretation, numbersInText, __setInterpreter };
