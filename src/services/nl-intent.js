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
  const me = senderName || 'ฉัน';
  const other = partnerName || 'แฟน';
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
    '  - ไวยากรณ์: "A ยืม B 500" = A เป็นคนยืม (ต้องคืน) / B เป็นคนให้ยืม (คนจ่ายเงิน) — คำหลัง "ยืม" คือคนที่ให้ยืม ไม่ใช่คนที่ต้องคืน',
    `  - ตัวอย่างตามชื่อจริง: "${me}ยืม${other} 500 ไปทำบุญ" → payer=partner, my_share=500, partner_share=0, description="ยืมเงินไปทำบุญ"`,
    `  - "${other}ยืม${me} 500" → payer=me, my_share=0, partner_share=500`,
    '  - ข้อความที่ตามหลังจำนวนเงิน (เช่น "ไปทำบุญ", "ซื้อกาแฟ") คือวัตถุประสงค์ ใส่ใน description ไม่มีผลต่อทิศทางหนี้',
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

// Test hook: clear the per-user rate limiter
function __resetRateLimit() {
  for (const key of Object.keys(callsByUser)) delete callsByUser[key];
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

const ME_ALIASES = ['ฉัน', 'เรา', 'ผม', 'หนู', 'ตัวเอง'];
const PARTNER_ALIASES = ['แฟน', 'เธอ', 'เขา', 'ที่รัก'];

function escapeRe(text) {
  return String(text).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// ภาษาไทยไม่มีเว้นวรรคระหว่างคำ → ตัดสินทิศทาง "ยืม" ด้วยโค้ด ไม่พึ่งโมเดลอย่างเดียว
// คืน 'me' | 'partner' = ใครเป็น "ผู้ยืม" (ต้องคืนเงิน) หรือ null ถ้าไม่ชัด
function detectBorrower(text, { senderName, partnerName } = {}) {
  const meNames = [...(senderName ? [senderName] : []), ...ME_ALIASES].map(escapeRe);
  const partnerNames = [...(partnerName ? [partnerName] : []), ...PARTNER_ALIASES].map(escapeRe);
  const ME = `(?:${meNames.join('|')})`;
  const PARTNER = `(?:${partnerNames.join('|')})`;
  const t = String(text).replace(/\s+/g, ' ');

  const test = (re) => re.test(t);
  // "X ให้ Y ยืม" (X = ผู้ให้, Y = ผู้ยืม)
  if (test(new RegExp(`${PARTNER}\\s*ให้\\s*${ME}\\s*ยืม`))) return 'me';
  if (test(new RegExp(`${ME}\\s*ให้\\s*${PARTNER}\\s*ยืม`))) return 'partner';
  // "X ให้ยืม" (ไม่มี Y: X = ผู้ให้, อีกฝ่าย = ผู้ยืม)
  if (test(new RegExp(`${PARTNER}\\s*ให้\\s*ยืม`))) return 'me';
  if (test(new RegExp(`${ME}\\s*ให้\\s*ยืม`))) return 'partner';
  // "X ยืม Y" (X = ผู้ยืม, Y = ผู้ให้ยืม)
  if (test(new RegExp(`${ME}\\s*(?:ขอ)?ยืม\\s*(?:เงิน|ตัง)?\\s*${PARTNER}`))) return 'me';
  if (test(new RegExp(`${PARTNER}\\s*(?:ขอ)?ยืม\\s*(?:เงิน|ตัง)?\\s*${ME}`))) return 'partner';
  // "ให้ X ยืม", "X ยืม ..." (ไม่มี Y)
  if (test(new RegExp(`ให้\\s*${PARTNER}\\s*ยืม`))) return 'partner';
  if (test(new RegExp(`ให้\\s*${ME}\\s*ยืม`))) return 'me';
  if (test(new RegExp(`${PARTNER}\\s*(?:ขอ)?ยืม`))) return 'partner';
  if (test(new RegExp(`${ME}\\s*(?:ขอ)?ยืม`))) return 'me';
  // "ยืม Y ..." → ผู้ส่งเป็นผู้ยืมจาก Y
  if (test(new RegExp(`ยืม\\s*(?:เงิน|ตัง)?\\s*${PARTNER}`))) return 'me';
  return null;
}

// ประโยคยืมเงินที่ทิศทางและยอดชัดเจน → สร้างรายการด้วยโค้ดเลย ไม่ต้องรอโมเดล (เร็ว เสถียร ไม่ผิดทิศ)
// คืน null ถ้ามีหลายตัวเลข / มี #ทริป / อ่านยอดไม่ได้ → ให้โมเดลช่วย
function parseLoanMessage(text, { senderName, partnerName } = {}) {
  const t = String(text || '').trim();
  if (!/ยืม/.test(t) || /#/.test(t)) return null;

  const tokens = [...t.replace(/(\d),(?=\d{3}\b)/g, '$1').matchAll(/(\d+(?:\.\d+)?)\s*(k|K|พัน|ร้อย|หมื่น|แสน)?(?:\s*บาท)?/g)];
  if (tokens.length !== 1) return null;

  const [full, num, unit] = tokens[0];
  const multiplier = { k: 1000, K: 1000, พัน: 1000, ร้อย: 100, หมื่น: 10000, แสน: 100000 }[unit] || 1;
  const amount = Math.round(Number(num) * multiplier * 100) / 100;
  if (!(amount > 0)) return null;

  // ไม่ระบุว่าใครยืม ("ยืม 500", "ยืมเงิน 500 ไปซื้อของ") → ผู้ส่งเป็นผู้ยืมจากแฟน
  const borrower = detectBorrower(t, { senderName, partnerName }) || 'me';

  const noise = [senderName, partnerName, ...ME_ALIASES, ...PARTNER_ALIASES].filter(Boolean).map(escapeRe);
  const rest = t.replace(full, ' ')
    .replace(new RegExp(noise.join('|'), 'g'), ' ')
    .replace(/ให้|ขอ|ตัง|เงิน|ยืม|บาท/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  return {
    description: rest ? `ยืมเงิน${rest.startsWith('ไป') ? '' : ' '}${rest}` : 'ยืมเงิน',
    amount,
    payer: borrower === 'me' ? 'partner' : 'me',
    split: 'custom',
    numPeople: null,
    myShare: borrower === 'me' ? amount : 0,
    partnerShare: borrower === 'me' ? 0 : amount,
    tripName: null,
  };
}

// บังคับทิศทางหนี้ของรายการยืมตามที่โค้ดอ่านได้ (ทับคำตอบของโมเดลถ้าขัดกัน)
function applyLoanDirection(expenses, text, names) {
  if (expenses.length !== 1 || !/ยืม/.test(text)) return expenses;
  const borrower = detectBorrower(text, names);
  if (!borrower) return expenses;

  const [e] = expenses;
  return [{
    ...e,
    split: 'custom',
    numPeople: null,
    payer: borrower === 'me' ? 'partner' : 'me',
    myShare: borrower === 'me' ? e.amount : 0,
    partnerShare: borrower === 'me' ? 0 : e.amount,
  }];
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
  if (!trimmed || trimmed.length > MAX_TEXT_LENGTH) return { ok: false, reason: 'bad_length' };

  const loan = parseLoanMessage(trimmed, context);
  if (loan) return { ok: true, expenses: [loan] };

  if (!isAvailable()) return { ok: false, reason: 'not_configured' };
  if (!allowCall(userId)) return { ok: false, reason: 'rate_limited' };

  try {
    const result = await interpreter(trimmed, { tripNames: [], ...context });
    const validated = validateInterpretation(result, trimmed);
    if (!validated.ok) return validated;
    return { ok: true, expenses: applyLoanDirection(validated.expenses, trimmed, context) };
  } catch (err) {
    console.error('NL_INTERPRET_FAILED', err?.message || err);
    return { ok: false, reason: 'api_error' };
  }
}

module.exports = { interpretExpenseMessage, validateInterpretation, detectBorrower, parseLoanMessage, numbersInText, __setInterpreter, __resetRateLimit };
