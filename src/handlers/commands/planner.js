// วันสำคัญ (วนทุกปี) และ To-Do ร่วมกัน — คำสั่งพิมพ์; ตัวส่งเตือนอยู่ที่ services/planner-reminders.js
const { addSpecialEvent, listSpecialEvents, deleteSpecialEvent, addTodo, listOpenTodos, completeTodo, deleteTodo, getUsers } = require('../../services/db');
const { eventListState, todoListState } = require('../state');
const { extractMonthDay, extractDueDate, nextOccurrence, localToday, daysBetween, fromIso } = require('../../utils/planner-dates');
const { MONTH_LABELS } = require('../../utils/parse-date');
const { stagesToSkipOnCreate, EVENT_STAGES, TODO_STAGES, reminderHour } = require('../../services/planner-reminders');

const MAX_BUTTONS = 12; // + ปุ่มเสริม = 13 (ขีดจำกัด quick reply)
const MIGRATION_HINT = 'ยังใช้ฟีเจอร์นี้ไม่ได้ — ต้องรัน supabase/migration_012_events_todos.sql ใน Supabase ก่อน';

// ตารางยังไม่ถูกสร้าง (ยังไม่รัน migration) → ตอบข้อความชัดเจน แทนที่จะ error เงียบ
async function guarded(fn) {
  try {
    return await fn();
  } catch (error) {
    console.error('PLANNER_COMMAND_FAILED', error?.message || error);
    return { type: 'error', reply: MIGRATION_HINT };
  }
}

const dateLabel = ({ y, m, d }, withYear) => `${d} ${MONTH_LABELS[m]}${withYear ? ` ${y + 543}` : ''}`;
const whenLabel = (days) => (days === 0 ? 'วันนี้' : days === 1 ? 'พรุ่งนี้' : days > 0 ? `อีก ${days} วัน` : `เลยกำหนด ${-days} วัน`);

// "1 3 5" / "1,3" / "2-4" → [1,3,5]
function parseNumbers(input) {
  const out = [];
  for (const m of String(input).matchAll(/(\d+)(?:\s*(?:-|ถึง)\s*(\d+))?/g)) {
    const from = Number(m[1]);
    const to = m[2] ? Number(m[2]) : from;
    if (to < from || to - from > 30) return null;
    for (let i = from; i <= to; i += 1) if (!out.includes(i)) out.push(i);
  }
  return out;
}

async function senderName(lineUserId) {
  const users = await getUsers();
  return users.find((u) => u.lineUserId === lineUserId)?.displayName || null;
}

// ---------------------------------------------------------------- วันสำคัญ

const kindOf = (title) => (/วันเกิด|birthday/i.test(title) ? 'birthday' : /ครบรอบ|anniversary|วันครบ/i.test(title) ? 'anniversary' : 'other');

function handleAddEvent(input, lineUserId) {
  return guarded(async () => {
    const usage = 'เพิ่มวันสำคัญ [ชื่อ] [วัน เดือน] เช่น เพิ่มวันสำคัญ วันเกิดแฟน 14 มี.ค. (ใส่ปีเกิด/ปีที่เริ่มด้วยจะบอกอายุ/ครบกี่ปี: 14 มี.ค. 2540)';
    const md = extractMonthDay(input);
    if (md?.error) return { type: 'error', reply: 'วันที่ไม่ถูกต้อง (เช่น 31 ก.พ.) ลองตรวจอีกครั้ง' };
    if (!md) return { type: 'error', reply: `ไม่พบวันที่ — ${usage}` };
    const title = md.text.replace(/^[\s:–-]+|[\s:–-]+$/g, '');
    if (!title) return { type: 'error', reply: `ระบุชื่อวันสำคัญด้วย — ${usage}` };

    const today = localToday();
    const occ = nextOccurrence(md.month, md.day, today);
    const daysUntil = daysBetween(today, occ);
    const skip = stagesToSkipOnCreate(daysUntil, today.hour, EVENT_STAGES).map((s) => `${occ.y}:${s}`);
    const event = await addSpecialEvent({ title, month: md.month, day: md.day, year: md.year, kind: kindOf(title), lineUserId, remindedKeys: skip });

    return {
      type: 'event_added',
      reply: [
        `🎉 บันทึกวันสำคัญ: ${event.title}`,
        `📅 ${md.day} ${MONTH_LABELS[md.month]}${md.year ? ` ${md.year + 543}` : ''} (ทุกปี) · ${whenLabel(daysUntil)}`,
        `จะเตือนทั้งคู่ล่วงหน้า 7 วัน, 1 วัน และวันจริง เวลา ${String(reminderHour()).padStart(2, '0')}:00 น.`,
      ].join('\n'),
      quickReplies: [{ label: '📅 ดูวันสำคัญ', text: 'วันสำคัญ' }],
    };
  });
}

function handleListEvents(lineUserId) {
  return guarded(async () => {
    const events = await listSpecialEvents();
    if (!events.length) {
      delete eventListState.pendingByUser[lineUserId];
      return { type: 'events', reply: 'ยังไม่มีวันสำคัญ\nเพิ่มได้ด้วย: เพิ่มวันสำคัญ วันเกิดแฟน 14 มี.ค.' };
    }
    const today = localToday();
    const rows = events
      .map((e) => ({ e, occ: nextOccurrence(e.month, e.day, today) }))
      .map((r) => ({ ...r, days: daysBetween(today, r.occ) }))
      .sort((a, b) => a.days - b.days);

    eventListState.pendingByUser[lineUserId] = rows.map((r) => r.e.id);
    const lines = rows.map(({ e, occ, days }, i) => {
      const n = e.year && occ.y - e.year > 0 ? ` · ${e.kind === 'birthday' ? `อายุ ${occ.y - e.year}` : `ครบ ${occ.y - e.year} ปี`}` : '';
      return `${i + 1}. ${e.title} — ${dateLabel(occ)} (${whenLabel(days)})${n}`;
    });
    return {
      type: 'events',
      reply: ['📅 วันสำคัญ (ใกล้สุดก่อน)', ...lines, '', 'ลบ: แตะปุ่ม ❌ หรือพิมพ์ ลบวันสำคัญ [เลข]'].join('\n'),
      quickReplies: rows.slice(0, MAX_BUTTONS).map(({ e }, i) => ({ label: `❌ ${i + 1}. ${e.title}`, text: `ลบวันสำคัญ ${i + 1}` })),
    };
  });
}

function handleDeleteEvent(input, lineUserId) {
  return guarded(async () => {
    const num = Number.parseInt(input, 10);
    if (!(num >= 1)) return { type: 'error', reply: 'ระบุหมายเลข เช่น ลบวันสำคัญ 1 (ดูเลขจาก วันสำคัญ)' };
    const snapshot = eventListState.pendingByUser[lineUserId];
    if (!snapshot) return { type: 'noop', reply: 'ยังไม่มีลิสต์ พิมพ์ วันสำคัญ เพื่อดูรายการก่อน' };
    const id = snapshot[num - 1];
    if (!id) return { type: 'error', reply: `ไม่พบวันสำคัญเลข ${num} (เลือกเลข 1-${snapshot.length})` };

    const event = (await listSpecialEvents()).find((e) => e.id === id);
    if (!event || !(await deleteSpecialEvent(id))) {
      return { type: 'error', reply: 'วันสำคัญนี้ถูกลบไปแล้ว', quickReplies: [{ label: '📅 ดูวันสำคัญ', text: 'วันสำคัญ' }] };
    }
    const rest = await handleListEvents(lineUserId);
    return { type: 'event_deleted', reply: `ลบวันสำคัญ "${event.title}" แล้ว\n\n${rest.reply}`, quickReplies: rest.quickReplies };
  });
}

// ---------------------------------------------------------------- To-Do ร่วมกัน

function handleAddTodo(input, lineUserId) {
  return guarded(async () => {
    const usage = 'เพิ่มงาน [ข้อความ] [วันครบกำหนด] เช่น เพิ่มงาน จองโรงแรม 25 ธ.ค. / เพิ่มงาน ซื้อนม พรุ่งนี้';
    const due = extractDueDate(input);
    if (due.error === 'bad_date') return { type: 'error', reply: 'วันที่ไม่ถูกต้อง (เช่น 31 ก.พ.) ลองตรวจอีกครั้ง' };
    if (due.error === 'past') return { type: 'error', reply: 'วันครบกำหนดผ่านไปแล้ว ระบุวันในอนาคต หรือไม่ใส่วันก็ได้' };
    const title = due.text.replace(/^[\s:–-]+|[\s:–-]+$/g, '');
    if (!title) return { type: 'error', reply: `ระบุข้อความงานด้วย — ${usage}` };

    const today = localToday();
    const dueParts = due.dueDate ? fromIso(due.dueDate) : null;
    const daysUntil = dueParts ? daysBetween(today, dueParts) : null;
    const skip = dueParts ? stagesToSkipOnCreate(daysUntil, today.hour, TODO_STAGES).map((s) => `${due.dueDate}:${s}`) : [];
    const todo = await addTodo({ title, dueDate: due.dueDate, lineUserId, createdByName: await senderName(lineUserId), remindedKeys: skip });

    return {
      type: 'todo_added',
      reply: [
        `📝 เพิ่มงาน: ${todo.title}`,
        dueParts ? `ครบกำหนด ${dateLabel(dueParts, dueParts.y !== today.y)} (${whenLabel(daysUntil)}) — จะเตือนทั้งคู่ ${String(reminderHour()).padStart(2, '0')}:00 น.` : 'ไม่มีกำหนดวัน',
      ].join('\n'),
      quickReplies: [{ label: '📋 ดูงานทั้งหมด', text: 'งาน' }],
    };
  });
}

function handleListTodos(lineUserId) {
  return guarded(async () => {
    const todos = await listOpenTodos();
    if (!todos.length) {
      delete todoListState.pendingByUser[lineUserId];
      return { type: 'todos', reply: '🎉 ไม่มีงานค้าง\nเพิ่มได้ด้วย: เพิ่มงาน ซื้อนม พรุ่งนี้' };
    }
    const me = await senderName(lineUserId);
    const today = localToday();
    todoListState.pendingByUser[lineUserId] = todos.map((t) => t.id);

    const lines = todos.map((t, i) => {
      const parts = [`${i + 1}. ${t.title}`];
      if (t.dueDate) {
        const days = daysBetween(today, fromIso(t.dueDate));
        parts.push(`— ${days < 0 ? '⚠️ ' : days === 0 ? '📌 ' : ''}${dateLabel(fromIso(t.dueDate))} (${whenLabel(days)})`);
      }
      if (t.createdByName && t.createdByName !== me) parts.push(`· ${t.createdByName} เพิ่ม`);
      return parts.join(' ');
    });
    return {
      type: 'todos',
      reply: ['📋 งานที่ต้องทำ (ร่วมกัน)', ...lines, '', 'เสร็จแล้ว: แตะปุ่ม ✅ หรือพิมพ์ เสร็จ [เลข] (หลายข้อ: เสร็จ 1 3) · ลบ: ลบงาน [เลข]'].join('\n'),
      quickReplies: todos.slice(0, MAX_BUTTONS).map((t, i) => ({ label: `✅ ${i + 1}. ${t.title}`, text: `เสร็จ ${i + 1}` })),
    };
  });
}

// อ้างเลขจากลิสต์ที่เพิ่งแสดง → todo id (กันกดผิดรายการเมื่อลำดับเลื่อน)
function resolveTodoIds(numbers, lineUserId) {
  const snapshot = todoListState.pendingByUser[lineUserId];
  if (!snapshot) return { error: { type: 'noop', reply: 'ยังไม่มีลิสต์ พิมพ์ งาน เพื่อดูรายการก่อน' } };
  const bad = numbers.filter((n) => n < 1 || n > snapshot.length);
  if (bad.length) return { error: { type: 'error', reply: `ไม่พบงานเลข ${bad.join(', ')} (เลือกเลข 1-${snapshot.length})` } };
  return { ids: numbers.map((n) => snapshot[n - 1]) };
}

function handleCompleteTodo(input, lineUserId) {
  return guarded(async () => {
    const numbers = parseNumbers(input);
    if (!numbers?.length) return { type: 'error', reply: 'ระบุหมายเลขงาน เช่น เสร็จ 2 หรือ เสร็จ 1 3 (ดูเลขจาก งาน)' };
    const { ids, error } = resolveTodoIds(numbers, lineUserId);
    if (error) return error;

    const open = await listOpenTodos();
    const name = await senderName(lineUserId);
    const done = [];
    let already = 0;
    for (const id of ids) {
      const t = open.find((x) => x.id === id);
      if (t && (await completeTodo(id, name))) done.push(t); else already += 1;
    }
    delete todoListState.pendingByUser[lineUserId];
    const rest = await handleListTodos(lineUserId);
    const head = [
      done.length ? `✅ เสร็จแล้ว ${done.length} งาน: ${done.map((t) => t.title).join(', ')}` : null,
      already ? `(${already} งานถูกทำเสร็จหรือลบไปแล้ว)` : null,
    ].filter(Boolean).join('\n');
    return { type: 'todo_done', reply: `${head}\n\n${rest.reply}`, quickReplies: rest.quickReplies };
  });
}

function handleDeleteTodo(input, lineUserId) {
  return guarded(async () => {
    const numbers = parseNumbers(input);
    if (!numbers?.length) return { type: 'error', reply: 'ระบุหมายเลขงาน เช่น ลบงาน 2 (ดูเลขจาก งาน)' };
    const { ids, error } = resolveTodoIds(numbers, lineUserId);
    if (error) return error;

    const open = await listOpenTodos();
    const removed = [];
    for (const id of ids) {
      const t = open.find((x) => x.id === id);
      if (t && (await deleteTodo(id))) removed.push(t);
    }
    delete todoListState.pendingByUser[lineUserId];
    const rest = await handleListTodos(lineUserId);
    const head = removed.length ? `🗑 ลบงานแล้ว: ${removed.map((t) => t.title).join(', ')}` : 'งานนี้ถูกทำเสร็จหรือลบไปแล้ว';
    return { type: 'todo_deleted', reply: `${head}\n\n${rest.reply}`, quickReplies: rest.quickReplies };
  });
}

module.exports = { handleAddEvent, handleListEvents, handleDeleteEvent, handleAddTodo, handleListTodos, handleCompleteTodo, handleDeleteTodo };
