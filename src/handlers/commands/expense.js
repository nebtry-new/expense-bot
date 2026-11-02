const { parseExpenseText, formatSplitMode } = require('../../utils/parser');
const { addExpense, logUnrecognizedMessage, logNlMessage, getUsers, getExpenses, getTrips, listUnrecognizedMessages, findLastExpense, findTripByName } = require('../../services/db');
const { interpretExpenseMessage } = require('../../services/nl-intent');
const { budgetAlerts, withAlerts } = require('../../services/budgets');
const { deleteConfirmState, deleteListState } = require('../state');

const MONTH_LABELS = ['', 'ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.', 'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.'];
const UNIT_WORDS = /^(ใบ|คน|ชิ้น|อัน|ที่|ชม|ชั่วโมง|กม|วัน|คืน|แก้ว|จาน|ห้อง|ครั้ง|เดือน|ปี|นาที)/;
const INLINE_BLOCKERS = /(#|ฉัน|แฟน|หาร|ส่วนตัว|ไม่หาร|ยืม|คืน|ออกให้|เลี้ยง|จ่ายแทน|\/)/;

// "ข้าว 100 กาแฟ 50" → ["ข้าว 100", "กาแฟ 50"] (ไม่งั้นจะบันทึกแค่ข้าวแล้วทิ้งกาแฟเงียบๆ)
// คืน null ถ้าไม่ใช่รูปแบบ "ชื่อ ตัวเลข" ซ้ำกันตลอดทั้งประโยค
function splitInlineItems(line, userNames = {}) {
  if (INLINE_BLOCKERS.test(line)) return null;
  if ([userNames.senderName, userNames.partnerName].filter(Boolean).some((n) => line.includes(n))) return null;

  const SEG = /\s*([^\d,+]+?)\s*(\d+(?:\.\d+)?)\s*(?:บาท)?\s*(?:และ|กับ|แล้วก็|แล้ว|,|\+)?/y;
  const items = [];
  SEG.lastIndex = 0;
  let m;
  while (SEG.lastIndex < line.length && (m = SEG.exec(line))) {
    const description = m[1].trim();
    if (description.length < 2 || UNIT_WORDS.test(description)) return null;
    items.push(`${description} ${m[2]}`);
  }
  return items.length >= 2 && SEG.lastIndex >= line.trim().length ? items : null;
}

// " 📅 1 พ.ย." เมื่อบันทึกย้อนหลัง
function backdateNote(userContext) {
  if (!userContext.createdAt) return '';
  const local = new Date(new Date(userContext.createdAt).getTime() + 7 * 60 * 60 * 1000);
  return ` 📅 ${local.getUTCDate()} ${MONTH_LABELS[local.getUTCMonth() + 1]}`;
}

async function handleExpenseLines(rawLines, userContext) {
  const lineUserId = userContext.lineUserId || 'unknown';
  const allUsers = await getUsers();
  const sender = allUsers.find((u) => u.lineUserId === lineUserId) || null;
  const partner = allUsers.find((u) => u.lineUserId !== lineUserId) || null;

  const userNames = {
    senderName: sender?.displayName || null,
    partnerName: partner?.displayName || null,
  };

  const inputLines = rawLines.length === 1 ? (splitInlineItems(rawLines[0], userNames) || rawLines) : rawLines;

  // Validate only — no DB writes. Returns { parsed, customAmounts, tripId } | { type: 'error' } | null
  const validateLine = async (line) => {
    const p = parseExpenseText(line, userNames);
    if (!p.amount) return null;

    if (p.splitMode === 'half' && p.splitWarning) {
      return {
        type: 'error',
        reply: `"${line}" — ชื่อในการแบ่งจ่าย "${p.splitWarning}" ไม่ตรงกับผู้ใช้ในระบบ ลองใช้ ฉัน/แฟน หรือชื่อที่ลงทะเบียนไว้แทน`,
      };
    }

    let customAmounts = null;
    if (p.splitMode === 'custom') {
      if (!sender) {
        return { type: 'error', reply: `"${line}" — ไม่พบผู้ใช้ของคุณในระบบ กรุณาลงทะเบียนก่อน` };
      }
      if (!partner) {
        return { type: 'error', reply: `"${line}" — ไม่สามารถระบุการแบ่งจ่ายได้ ยังไม่มีผู้ใช้คนที่ 2 ในระบบ` };
      }
      if (p.customAmounts) {
        const { me, partner: partnerAmt } = p.customAmounts;
        if (Math.abs(me + partnerAmt - p.amount) > 0.01) {
          return {
            type: 'error',
            reply: `"${line}" — ยอดที่ระบุ (${me} + ${partnerAmt} = ${me + partnerAmt}) ไม่ตรงกับยอดรวม ${p.amount} บาท`,
          };
        }
        customAmounts = {
          [String(sender.id)]: me,
          [String(partner.id)]: partnerAmt,
        };
      }
    }

    let tripId = null;
    if (p.tripTag) {
      const trip = await findTripByName(p.tripTag);
      if (!trip) {
        return { type: 'error', reply: `"${line}" — ไม่พบทริป "#${p.tripTag}" สร้างก่อนด้วย: สร้างทริป ${p.tripTag}` };
      }
      tripId = trip.id;

      // Apply trip's default split mode when user didn't explicitly specify one
      if (!p.splitExplicit && trip.default_split_mode && trip.default_split_mode !== 'half') {
        p.splitMode = trip.default_split_mode;
        p.numPeople = trip.default_num_people || null;
      }
    }

    return { parsed: p, customAmounts, tripId, line };
  };

  // Write to DB — only called after all validations pass
  const writeLine = async ({ parsed, customAmounts, tripId }) => {
    const saved = await addExpense({
      paidByUserId: sender ? sender.id : lineUserId,
      paidByDisplayName: sender ? sender.displayName : lineUserId,
      description: parsed.description,
      amount: parsed.amount,
      splitMode: parsed.splitMode,
      numPeople: parsed.numPeople,
      customAmounts,
      tripId,
      ...(userContext.createdAt ? { createdAt: userContext.createdAt } : {}),
    });
    return { parsed, saved };
  };

  if (inputLines.length > 1) {
    // Propagate a shared #tag to lines that don't have one
    const tags = inputLines.map((l) => { const m = l.match(/#[฀-๿a-zA-Z0-9_]+/); return m ? m[0].slice(1) : null; });
    const uniqueTags = [...new Set(tags.filter(Boolean))];
    const sharedTag = uniqueTags.length === 1 ? uniqueTags[0] : null;
    const resolvedLines = sharedTag
      ? inputLines.map((l, i) => tags[i] ? l : `${l} #${sharedTag}`)
      : inputLines;

    const validated = await Promise.all(resolvedLines.map(validateLine));
    const errors = validated.filter((r) => r?.type === 'error');
    if (errors.length) {
      return { type: 'error', reply: errors.map((e) => e.reply).join('\n') };
    }

    const toWrite = validated.filter(Boolean);
    if (!toWrite.length) {
      return { type: 'noop', reply: 'ไม่พบจำนวนเงินที่บันทึกได้' };
    }

    const results = await Promise.all(toWrite.map(writeLine));
    const total = results.reduce((sum, r) => sum + r.parsed.amount, 0);
    const itemLines = results.map((r) => `• ${r.parsed.description} ${r.parsed.amount.toLocaleString()} บาท (${formatSplitMode(r.parsed.splitMode, r.parsed.numPeople)})`);

    const alerts = await budgetAlerts(results.map((r) => r.saved));
    return {
      type: 'expense_batch',
      results,
      reply: withAlerts([`บันทึก ${results.length} รายการแล้ว${backdateNote(userContext)}:`, ...itemLines, `รวม: ${total.toLocaleString()} บาท`].join('\n'), alerts),
    };
  }

  const validated = await validateLine(inputLines[0]);
  if (!validated) {
    return { type: 'noop', reply: 'ไม่พบจำนวนเงินที่บันทึกได้' };
  }
  if (validated.type === 'error') {
    return validated;
  }

  const result = await writeLine(validated);
  const alerts = await budgetAlerts([result.saved]);
  return {
    type: 'expense',
    parsed: result.parsed,
    saved: result.saved,
    reply: withAlerts(`บันทึกค่าใช้จ่ายแล้ว${backdateNote(userContext)}: ${result.parsed.description} ${result.parsed.amount.toLocaleString()} บาท (${formatSplitMode(result.parsed.splitMode, result.parsed.numPeople)})`, alerts),
  };
}

async function handleDeleteLastExpense(userContext) {
  const currentLineUserId = userContext.lineUserId || 'unknown';
  const allUsers = await getUsers();
  const currentUser = allUsers.find((u) => u.lineUserId === currentLineUserId);

  if (!currentUser) {
    return { type: 'error', reply: 'ไม่พบผู้ใช้ในระบบ กรุณาลงทะเบียนก่อน' };
  }

  const target = await findLastExpense(currentUser.id);

  if (!target) {
    return { type: 'noop', reply: 'ไม่พบรายการที่สามารถยกเลิกได้' };
  }

  deleteConfirmState.pendingByUser[currentLineUserId] = target;

  return {
    type: 'expense_delete_prompt',
    reply: `รายการ: ${target.description} ${Number(target.amount).toLocaleString()} บาท\nต้องการยกเลิกใช่หรือไม่? พิมพ์ ใช่ เพื่อยืนยัน`,
    quickReplies: CONFIRM_DELETE_REPLIES,
  };
}

const NL_FAIL_REPLIES = {
  amount_not_in_text: 'อ่านจำนวนเงินจากข้อความไม่ชัดเจน กรุณาพิมพ์ยอดเป็นตัวเลข เช่น ค่าข้าว 450',
  custom_sum_mismatch: 'ยอดที่แบ่งไม่ตรงกับยอดรวม กรุณาระบุใหม่ เช่น ค่าข้าว 450 ฉัน 200 แฟน 250',
  credit_exhausted: 'ระบบ AI ใช้งานไม่ได้ชั่วคราว (เครดิต Anthropic API หมด) กรุณาพิมพ์ตามรูปแบบเดิมไปก่อน เช่น ค่าข้าว 450 ฉัน 0 แฟน 450',
  api_error: 'ระบบ AI ตอบไม่ทัน ยังไม่ได้บันทึกอะไร กรุณาลองใหม่ หรือพิมพ์ตามรูปแบบเดิม เช่น ค่าข้าว 450 ฉัน 0 แฟน 450',
  rate_limited: 'ส่งข้อความถี่เกินไป กรุณารอสักครู่แล้วลองใหม่',
};

// ข้อความภาษาธรรมชาติที่ parser เดิมอ่านไม่ได้ → ให้ Claude ตีความ → ตรวจ → บันทึก
// คืน null ถ้าตีความไม่ได้ (ให้ผู้เรียกตอบ noop เดิม)
async function handleNaturalLanguageExpense(text, userContext) {
  const lineUserId = userContext.lineUserId || 'unknown';
  const allUsers = await getUsers();
  const sender = allUsers.find((u) => u.lineUserId === lineUserId) || null;
  const partner = allUsers.find((u) => u.lineUserId !== lineUserId) || null;
  if (!sender) return null;

  const trips = await getTrips();
  const interpreted = await interpretExpenseMessage(text, {
    senderName: sender.displayName,
    partnerName: partner?.displayName || null,
    tripNames: trips.map((t) => t.name),
  }, lineUserId);

  // ข้อมูลสำหรับ log วิเคราะห์ (nl_message_log) — เติม outcome/expenseIds ตอนจบ
  const logBase = {
    lineUserId,
    text,
    route: interpreted.source,
    model: interpreted.model,
    latencyMs: interpreted.latencyMs,
    hasDate: Boolean(userContext.createdAt),
    interpreted: interpreted.ok ? interpreted.expenses : interpreted.raw,
  };

  // โมเดลบอกว่าไม่ใช่การบันทึกค่าใช้จ่าย แต่เป็นคำสั่ง/ตั้งเตือน/ถามข้อมูล → ให้ text.js ส่งต่อ
  if (!interpreted.ok && interpreted.reason === 'other_intent') {
    await logNlMessage({ ...logBase, outcome: 'routed', reason: interpreted.other.intent, interpreted: interpreted.other });
    return { type: 'nl_other', other: interpreted.other };
  }

  if (!interpreted.ok) {
    await logNlMessage({ ...logBase, outcome: 'failed', reason: interpreted.reason });
    // เก็บเฉพาะข้อความที่ดูเหมือนพยายามบันทึกเงิน (มีตัวเลขหรือคำบอกการจ่าย/ยืม) ไม่เก็บคำทักทาย
    if (/\d|ยืม|คืน|เลี้ยง|ออกให้|จ่าย/.test(text)) {
      await logUnrecognizedMessage({ lineUserId, text, reason: interpreted.reason });
    }
    const reply = NL_FAIL_REPLIES[interpreted.reason];
    return reply ? { type: 'error', reply } : null;
  }

  // Validate everything first — write only if all items pass
  const prepared = [];
  for (const item of interpreted.expenses) {
    if ((item.payer === 'partner' || item.split === 'custom') && !partner) {
      await logNlMessage({ ...logBase, outcome: 'rejected', reason: 'no_partner' });
      return { type: 'error', reply: 'ยังไม่มีผู้ใช้คนที่ 2 ในระบบ จึงบันทึกรายการแบบนี้ไม่ได้' };
    }

    let tripId = null;
    let { split, numPeople } = item;
    if (item.tripName) {
      const trip = trips.find((t) => (t.name || '').toLowerCase() === item.tripName.toLowerCase());
      if (!trip) {
        await logNlMessage({ ...logBase, outcome: 'rejected', reason: 'trip_not_found' });
        return { type: 'error', reply: `ไม่พบทริป "${item.tripName}" สร้างก่อนด้วย: สร้างทริป ${item.tripName}` };
      }
      tripId = trip.id;
      if (split === 'half' && trip.default_split_mode && trip.default_split_mode !== 'half') {
        split = trip.default_split_mode;
        numPeople = trip.default_num_people || null;
      }
    }

    const payerUser = item.payer === 'partner' ? partner : sender;
    const customAmounts = split === 'custom'
      ? { [String(sender.id)]: item.myShare, [String(partner.id)]: item.partnerShare }
      : null;

    prepared.push({ item, split, numPeople, tripId, payerUser, customAmounts });
  }

  const lines = [];
  const expenseIds = [];
  const savedItems = [];
  for (const { item, split, numPeople, tripId, payerUser, customAmounts } of prepared) {
    const saved = await addExpense({
      paidByUserId: payerUser.id,
      paidByDisplayName: payerUser.displayName,
      description: item.description,
      amount: item.amount,
      splitMode: split,
      numPeople,
      customAmounts,
      tripId,
      ...(userContext.createdAt ? { createdAt: userContext.createdAt } : {}),
    });
    if (saved?.id) expenseIds.push(saved.id);
    savedItems.push(saved);
    const payerNote = payerUser.id === sender.id ? '' : ` — ${payerUser.displayName} จ่าย`;
    lines.push(`• ${item.description} ${item.amount.toLocaleString()} บาท (${formatSplitMode(split, numPeople)})${payerNote}`);

    // custom ที่อีกฝ่ายรับเต็มจำนวน → บอกชัดๆ ว่าใครต้องคืนใคร จะได้เห็นถ้าตีความทิศทางผิด
    if (item.kind === 'repayment') {
      const receiver = payerUser.id === sender.id ? partner : sender;
      lines.push(`  → ${payerUser.displayName} คืนเงินให้ ${receiver.displayName} (หักจากยอดค้าง)`);
    } else if (split === 'custom') {
      const other = payerUser.id === sender.id ? partner : sender;
      const otherShare = customAmounts[String(other.id)];
      if (Math.abs(otherShare - item.amount) < 0.01) {
        lines.push(`  → ${other.displayName} ต้องคืน ${payerUser.displayName} เต็มจำนวน ${item.amount.toLocaleString()} บาท`);
      }
    }
  }

  await logNlMessage({ ...logBase, outcome: 'saved', expenseIds });

  const alerts = await budgetAlerts(savedItems);
  return {
    type: 'expense_nl',
    reply: withAlerts([
      `บันทึกแล้ว${backdateNote(userContext)} (ตีความจากข้อความ ${prepared.length} รายการ):`,
      ...lines,
      '',
      'ถ้าไม่ถูก พิมพ์ ลบรายการ เพื่อเลือกลบ',
    ].join('\n'), alerts),
    quickReplies: [{ label: 'ลบรายการ', text: 'ลบรายการ' }],
  };
}

// 12 รายการ + ปุ่ม ยกเลิก = 13 ปุ่ม พอดีขีดจำกัด quick reply ของ LINE
const DELETE_LIST_LIMIT = 12;
const CONFIRM_DELETE_REPLIES = [{ label: 'ใช่ ลบเลย', text: 'ใช่' }, { label: 'ไม่ลบ', text: 'ยกเลิก' }];

// แสดงรายการที่ยังไม่เคลียร์ของทั้งสองคน (รวมรายการในทริป) โดยกำกับชื่อคนจ่ายถ้าไม่ใช่ของตัวเอง ให้เลือกลบด้วยเลข
// keyword (optional) กรองจากชื่อรายการหรือชื่อทริป
async function handleListUnrecognized() {
  const [rows, users] = await Promise.all([listUnrecognizedMessages(10), getUsers()]);
  if (!rows.length) return { type: 'unrecognized', reply: 'ยังไม่มีข้อความที่บอตไม่เข้าใจ 🎉' };

  const nameByLine = Object.fromEntries(users.map((u) => [u.lineUserId, u.displayName]));
  const lines = rows.map((r, i) => {
    const local = new Date(new Date(r.created_at).getTime() + 7 * 60 * 60 * 1000);
    const when = `${local.getUTCDate()} ${MONTH_LABELS[local.getUTCMonth() + 1]} ${String(local.getUTCHours()).padStart(2, '0')}:${String(local.getUTCMinutes()).padStart(2, '0')}`;
    return `${i + 1}. [${when}] ${nameByLine[r.line_user_id] || '?'}: ${r.text}\n   เหตุผล: ${r.reason || '-'}`;
  });
  return { type: 'unrecognized', reply: ['ข้อความที่บอตไม่เข้าใจ (ล่าสุด 10 รายการ):', ...lines].join('\n') };
}

async function handleListDeletableExpenses(keyword, userContext) {
  const lineUserId = userContext.lineUserId || 'unknown';
  const allUsers = await getUsers();
  const currentUser = allUsers.find((u) => u.lineUserId === lineUserId);
  if (!currentUser) {
    return { type: 'error', reply: 'ไม่พบผู้ใช้ในระบบ กรุณาลงทะเบียนก่อน' };
  }

  const [expenses, trips] = await Promise.all([getExpenses(), getTrips()]);
  const tripsMap = Object.fromEntries(trips.map((t) => [t.id, t.name]));
  const usersMap = Object.fromEntries(allUsers.map((u) => [String(u.id), u.displayName]));
  const kw = (keyword || '').replace(/^#/, '').trim().toLowerCase();

  // getExpenses() เรียงเก่า→ใหม่; รายการที่ createdAt ซ้ำกัน (เช่นพิมพ์หลายบรรทัดในข้อความเดียว) ใช้ลำดับเดิมตัดสิน
  const indexOf = new Map(expenses.map((e, i) => [e.id, i]));
  const candidates = expenses
    .filter((e) => !e.isCleared)
    .filter((e) => !kw
      || String(e.description || '').toLowerCase().includes(kw)
      || String(tripsMap[e.tripId] || '').toLowerCase().includes(kw))
    .sort((a, b) => (new Date(b.createdAt) - new Date(a.createdAt)) || (indexOf.get(b.id) - indexOf.get(a.id)))
    .slice(0, DELETE_LIST_LIMIT);

  if (!candidates.length) {
    return { type: 'noop', reply: 'ไม่พบรายการที่สามารถลบได้' };
  }

  deleteListState.pendingByUser[lineUserId] = candidates.map((e) => ({
    id: e.id,
    description: e.description,
    amount: Number(e.amount),
    paidByName: String(e.paidByUserId) === String(currentUser.id) ? null : usersMap[String(e.paidByUserId)] || null,
  }));

  const lines = candidates.map((e, i) => {
    const trip = e.tripId ? ` [${tripsMap[e.tripId] || 'ทริป'}]` : '';
    const payer = String(e.paidByUserId) === String(currentUser.id) ? '' : ` (${usersMap[String(e.paidByUserId)] || 'แฟน'} จ่าย)`;
    return `${i + 1}. ${e.description}${trip} ${Number(e.amount).toLocaleString()} บาท${payer}`;
  });

  return {
    type: 'expense_delete_list',
    reply: ['รายการที่ลบได้ (ใหม่สุดก่อน):', ...lines, '', 'แตะปุ่มด้านล่างเพื่อเลือก หรือพิมพ์หลายเลข เช่น ลบ 1 3'].join('\n'),
    quickReplies: [
      ...candidates.map((e, i) => ({ label: `${i + 1}. ${e.description}`, text: `ลบ ${i + 1}` })),
      { label: 'ยกเลิก', text: 'ยกเลิก' },
    ],
  };
}

// "1 3 5" / "1,3,5" / "1 และ 3" / "2-4" / "2ถึง4" → [1,3,5] (ไม่ซ้ำ เรียงตามที่พิมพ์) ; คืน null ถ้าช่วงไม่สมเหตุสมผล
function parseIndexList(spec) {
  const out = [];
  const re = /(\d+)(?:\s*(?:-|ถึง)\s*(\d+))?/g;
  let m;
  while ((m = re.exec(String(spec)))) {
    const from = Number.parseInt(m[1], 10);
    const to = m[2] ? Number.parseInt(m[2], 10) : from;
    if (to < from || to - from > DELETE_LIST_LIMIT) return null;
    for (let i = from; i <= to; i += 1) if (!out.includes(i)) out.push(i);
  }
  return out;
}

const fmtTarget = (t) => `${t.description} ${Number(t.amount).toLocaleString()} บาท${t.paidByName ? ` (${t.paidByName} จ่าย)` : ''}`;

// ผู้ใช้เลือกเลขจากลิสต์ (เลขเดียวหรือหลายเลขในคำสั่งเดียว) → ขอยืนยัน (ใช้ flow "ใช่" เดิม)
function handlePickDeleteExpense(spec, userContext) {
  const lineUserId = userContext.lineUserId || 'unknown';
  const list = deleteListState.pendingByUser[lineUserId];
  if (!list) {
    return { type: 'noop', reply: 'ยังไม่มีลิสต์รายการ พิมพ์ ลบรายการ เพื่อดูรายการที่ลบได้ก่อน' };
  }

  const indexes = parseIndexList(spec);
  if (!indexes || !indexes.length) {
    return { type: 'error', reply: `รูปแบบเลขไม่ถูกต้อง ตัวอย่าง: ลบ 2 หรือ ลบ 1 3 5 หรือ ลบ 2-4 (เลข 1-${list.length})` };
  }
  const bad = indexes.filter((i) => i < 1 || i > list.length);
  if (bad.length) {
    return { type: 'error', reply: `ไม่พบรายการเลข ${bad.join(', ')} กรุณาเลือกเลข 1-${list.length}` };
  }

  const targets = indexes.map((i) => list[i - 1]);
  console.log('DELETE_PICK', { lineUserId, indexes, picked: targets.map((t) => t.id), list: list.map((t) => t.id) });
  delete deleteListState.pendingByUser[lineUserId];

  if (targets.length === 1) {
    deleteConfirmState.pendingByUser[lineUserId] = targets[0];
    return {
      type: 'expense_delete_prompt',
      reply: `รายการ: ${fmtTarget(targets[0])}\nต้องการลบใช่หรือไม่? พิมพ์ ใช่ เพื่อยืนยัน`,
      quickReplies: CONFIRM_DELETE_REPLIES,
    };
  }

  deleteConfirmState.pendingByUser[lineUserId] = { items: targets };
  const total = targets.reduce((sum, t) => sum + Number(t.amount), 0);
  return {
    type: 'expense_delete_prompt',
    reply: [
      `จะลบ ${targets.length} รายการ:`,
      ...targets.map((t, i) => `${indexes[i]}. ${fmtTarget(t)}`),
      `รวม ${total.toLocaleString()} บาท`,
      'ต้องการลบทั้งหมดใช่หรือไม่? พิมพ์ ใช่ เพื่อยืนยัน',
    ].join('\n'),
    quickReplies: CONFIRM_DELETE_REPLIES,
  };
}

module.exports = { handleListUnrecognized, handleNaturalLanguageExpense, handleExpenseLines, handleDeleteLastExpense, handleListDeletableExpenses, handlePickDeleteExpense };
