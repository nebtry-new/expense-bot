const { parseExpenseText, formatSplitMode } = require('../../utils/parser');
const { addExpense, getUsers, getExpenses, getTrips, findLastExpense, findTripByName } = require('../../services/db');
const { interpretExpenseMessage } = require('../../services/nl-intent');
const { deleteConfirmState, deleteListState } = require('../state');

async function handleExpenseLines(inputLines, userContext) {
  const lineUserId = userContext.lineUserId || 'unknown';
  const allUsers = await getUsers();
  const sender = allUsers.find((u) => u.lineUserId === lineUserId) || null;
  const partner = allUsers.find((u) => u.lineUserId !== lineUserId) || null;

  const userNames = {
    senderName: sender?.displayName || null,
    partnerName: partner?.displayName || null,
  };

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

    return {
      type: 'expense_batch',
      results,
      reply: [`บันทึก ${results.length} รายการแล้ว:`, ...itemLines, `รวม: ${total.toLocaleString()} บาท`].join('\n'),
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
  return {
    type: 'expense',
    parsed: result.parsed,
    saved: result.saved,
    reply: `บันทึกค่าใช้จ่ายแล้ว: ${result.parsed.description} ${result.parsed.amount.toLocaleString()} บาท (${formatSplitMode(result.parsed.splitMode, result.parsed.numPeople)})`,
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
  };
}

const NL_FAIL_REPLIES = {
  amount_not_in_text: 'อ่านจำนวนเงินจากข้อความไม่ชัดเจน กรุณาพิมพ์ยอดเป็นตัวเลข เช่น ค่าข้าว 450',
  custom_sum_mismatch: 'ยอดที่แบ่งไม่ตรงกับยอดรวม กรุณาระบุใหม่ เช่น ค่าข้าว 450 ฉัน 200 แฟน 250',
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

  if (!interpreted.ok) {
    const reply = NL_FAIL_REPLIES[interpreted.reason];
    return reply ? { type: 'error', reply } : null;
  }

  // Validate everything first — write only if all items pass
  const prepared = [];
  for (const item of interpreted.expenses) {
    if ((item.payer === 'partner' || item.split === 'custom') && !partner) {
      return { type: 'error', reply: 'ยังไม่มีผู้ใช้คนที่ 2 ในระบบ จึงบันทึกรายการแบบนี้ไม่ได้' };
    }

    let tripId = null;
    let { split, numPeople } = item;
    if (item.tripName) {
      const trip = trips.find((t) => (t.name || '').toLowerCase() === item.tripName.toLowerCase());
      if (!trip) {
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
  for (const { item, split, numPeople, tripId, payerUser, customAmounts } of prepared) {
    await addExpense({
      paidByUserId: payerUser.id,
      paidByDisplayName: payerUser.displayName,
      description: item.description,
      amount: item.amount,
      splitMode: split,
      numPeople,
      customAmounts,
      tripId,
    });
    const payerNote = payerUser.id === sender.id ? '' : ` — ${payerUser.displayName} จ่าย`;
    lines.push(`• ${item.description} ${item.amount.toLocaleString()} บาท (${formatSplitMode(split, numPeople)})${payerNote}`);

    // custom ที่อีกฝ่ายรับเต็มจำนวน → บอกชัดๆ ว่าใครต้องคืนใคร จะได้เห็นถ้าตีความทิศทางผิด
    if (split === 'custom') {
      const other = payerUser.id === sender.id ? partner : sender;
      const otherShare = customAmounts[String(other.id)];
      if (Math.abs(otherShare - item.amount) < 0.01) {
        lines.push(`  → ${other.displayName} ต้องคืน ${payerUser.displayName} เต็มจำนวน ${item.amount.toLocaleString()} บาท`);
      }
    }
  }

  return {
    type: 'expense_nl',
    reply: [
      `บันทึกแล้ว (ตีความจากข้อความ ${prepared.length} รายการ):`,
      ...lines,
      '',
      'ถ้าไม่ถูก พิมพ์ ลบรายการ เพื่อเลือกลบ',
    ].join('\n'),
  };
}

const DELETE_LIST_LIMIT = 15;

// แสดงรายการที่ยังไม่เคลียร์ของผู้ใช้ (รวมรายการในทริป) ให้เลือกลบด้วยเลข
// keyword (optional) กรองจากชื่อรายการหรือชื่อทริป
async function handleListDeletableExpenses(keyword, userContext) {
  const lineUserId = userContext.lineUserId || 'unknown';
  const allUsers = await getUsers();
  const currentUser = allUsers.find((u) => u.lineUserId === lineUserId);
  if (!currentUser) {
    return { type: 'error', reply: 'ไม่พบผู้ใช้ในระบบ กรุณาลงทะเบียนก่อน' };
  }

  const [expenses, trips] = await Promise.all([getExpenses(), getTrips()]);
  const tripsMap = Object.fromEntries(trips.map((t) => [t.id, t.name]));
  const kw = (keyword || '').replace(/^#/, '').trim().toLowerCase();

  // getExpenses() เรียงเก่า→ใหม่; รายการที่ createdAt ซ้ำกัน (เช่นพิมพ์หลายบรรทัดในข้อความเดียว) ใช้ลำดับเดิมตัดสิน
  const indexOf = new Map(expenses.map((e, i) => [e.id, i]));
  const candidates = expenses
    .filter((e) => String(e.paidByUserId) === String(currentUser.id) && !e.isCleared)
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
  }));

  const lines = candidates.map((e, i) => {
    const trip = e.tripId ? ` [${tripsMap[e.tripId] || 'ทริป'}]` : '';
    return `${i + 1}. ${e.description}${trip} ${Number(e.amount).toLocaleString()} บาท`;
  });

  return {
    type: 'expense_delete_list',
    reply: ['รายการที่ลบได้ (ใหม่สุดก่อน):', ...lines, '', 'พิมพ์ ลบ [เลข] เพื่อเลือกรายการ เช่น ลบ 2'].join('\n'),
  };
}

// ผู้ใช้เลือกเลขจากลิสต์ → ขอยืนยัน (ใช้ flow "ใช่" เดิม)
function handlePickDeleteExpense(index, userContext) {
  const lineUserId = userContext.lineUserId || 'unknown';
  const list = deleteListState.pendingByUser[lineUserId];
  if (!list) {
    return { type: 'noop', reply: 'ยังไม่มีลิสต์รายการ พิมพ์ ลบรายการ เพื่อดูรายการที่ลบได้ก่อน' };
  }

  const target = list[index - 1];
  if (!target) {
    return { type: 'error', reply: `ไม่พบรายการเลข ${index} กรุณาเลือกเลข 1-${list.length}` };
  }

  console.log('DELETE_PICK', { lineUserId, index, picked: target.id, list: list.map((t) => t.id) });
  delete deleteListState.pendingByUser[lineUserId];
  deleteConfirmState.pendingByUser[lineUserId] = target;

  return {
    type: 'expense_delete_prompt',
    reply: `รายการ: ${target.description} ${Number(target.amount).toLocaleString()} บาท\nต้องการลบใช่หรือไม่? พิมพ์ ใช่ เพื่อยืนยัน`,
  };
}

module.exports = { handleNaturalLanguageExpense, handleExpenseLines, handleDeleteLastExpense, handleListDeletableExpenses, handlePickDeleteExpense };
