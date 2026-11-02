// เตือนวันสำคัญ (7 วันก่อน / 1 วันก่อน / วันจริง) และ To-Do ที่ครบกำหนด (1 วันก่อน / วันนี้)
// ส่งให้ทั้งคู่ เวลา 09:00 เวลาไทย (ปรับด้วย EVENT_REMINDER_HOUR) — ตัวรันเดียวกับแจ้งเตือนอื่นใน index.js (ทุก 60 วิ)
// กันส่งซ้ำด้วย reminded_keys ในตาราง (รอดการรีสตาร์ท) · ส่งไม่สำเร็จจะไม่นับว่าเตือนแล้ว รอบหน้าลองใหม่
// ข้อความวันจริงให้โมเดลเขียนให้น่ารัก (มี fallback เป็นข้อความสำเร็จรูปเสมอ — เครดิตหมด/API ล้มก็ยังเตือน)
const Anthropic = require('@anthropic-ai/sdk');
const { listSpecialEvents, markEventReminded, listOpenTodos, markTodoReminded, getUsers } = require('./db');
const { localToday, daysBetween, nextOccurrence, fromIso } = require('../utils/planner-dates');
const { MONTH_LABELS } = require('../utils/parse-date');

const EVENT_STAGES = [7, 1, 0];
const TODO_STAGES = [1, 0];
const MODEL = process.env.NL_MODEL || 'claude-haiku-5-5';
const GREETING_TIMEOUT_MS = 8000;

const client = process.env.ANTHROPIC_API_KEY ? new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY }) : null;

const reminderHour = () => {
  const h = Number(process.env.EVENT_REMINDER_HOUR);
  return Number.isInteger(h) && h >= 0 && h <= 23 ? h : 9;
};

// รอบที่ "ไม่ควรเตือนย้อนหลัง" ตอนเพิ่มรายการ: ถึงวันนั้นแล้วแต่เลยเวลาเตือนของวันไปแล้ว → ถือว่าเตือนแล้ว
function stagesToSkipOnCreate(daysUntil, hour, stages) {
  return stages.filter((s) => s === daysUntil && hour >= reminderHour());
}

function ageText(event, occYear) {
  if (!event.year) return '';
  const n = occYear - event.year;
  if (n <= 0) return '';
  return event.kind === 'birthday' ? ` (อายุ ${n} ปี)` : ` (ครบ ${n} ปี)`;
}

function fallbackGreeting(event) {
  return event.kind === 'birthday'
    ? 'สุขสันต์วันเกิดนะ ขอให้วันนี้เป็นวันที่มีความสุขที่สุด 🎂'
    : event.kind === 'anniversary'
      ? 'ขอให้เรามีความสุขด้วยกันแบบนี้ไปอีกนานๆ นะ 💕'
      : 'ขอให้เป็นวันที่ดีของเรานะ 💕';
}

async function writeGreetingWithModel(event, years) {
  if (!client) return null;
  const response = await client.messages.create({
    model: MODEL,
    max_tokens: 150,
    messages: [{
      role: 'user',
      content: [
        'เขียนข้อความสั้นๆ น่ารักๆ เป็นภาษาไทย 1-2 ประโยค จากบอตถึงคู่รักคู่หนึ่ง ในวันสำคัญของพวกเขา',
        `วันสำคัญ: ${event.title}${years ? ` (${years} ปี)` : ''}`,
        'กฎ: ห้ามแต่งข้อเท็จจริงเพิ่ม (ชื่อคน สถานที่ ของขวัญ) ใช้อีโมจิได้ไม่เกิน 2 ตัว ตอบเฉพาะข้อความ ไม่ต้องมีคำอธิบาย',
      ].join('\n'),
    }],
  }, { timeout: GREETING_TIMEOUT_MS });
  const text = response.content.find((b) => b.type === 'text')?.text?.trim();
  return text && text.length <= 220 ? text : null;
}

let greetingWriter = writeGreetingWithModel;
function __setGreetingWriter(fn) { greetingWriter = fn || writeGreetingWithModel; } // test hook

async function greetingFor(event, years) {
  try {
    return (await greetingWriter(event, years)) || fallbackGreeting(event);
  } catch (error) {
    console.error('EVENT_GREETING_FAILED', error?.message || error);
    return fallbackGreeting(event);
  }
}

async function eventMessage(event, occ, daysUntil) {
  const label = `${occ.d} ${MONTH_LABELS[occ.m]}`;
  const age = ageText(event, occ.y);
  if (daysUntil === 7) return `📅 อีก 7 วันถึง "${event.title}" (${label})${age}\nถึงเวลาเตรียมของขวัญหรือวางแผนกันแล้วนะ`;
  if (daysUntil === 1) return `⏰ พรุ่งนี้ "${event.title}" (${label})${age}\nเตรียมตัวกันหรือยังนะ`;
  const years = event.year && occ.y - event.year > 0 ? occ.y - event.year : null;
  return `🎉 วันนี้ "${event.title}"${age}\n${await greetingFor(event, years)}`;
}

async function pushToAll(sendPushFn, text) {
  const users = await getUsers();
  let delivered = 0;
  for (const u of users) {
    if (!u.lineUserId) continue;
    try {
      if (await sendPushFn(u.lineUserId, text)) delivered += 1;
    } catch (error) {
      console.error('PLANNER_PUSH_FAILED', error?.message || error);
    }
  }
  return delivered;
}

async function runEventReminders(sendPushFn, now = new Date()) {
  const today = localToday(now);
  if (today.hour < reminderHour()) return { sent: 0 };

  let sent = 0;
  for (const event of await listSpecialEvents()) {
    const occ = nextOccurrence(event.month, event.day, today);
    const daysUntil = daysBetween(today, occ);
    if (!EVENT_STAGES.includes(daysUntil)) continue;
    const key = `${occ.y}:${daysUntil}`;
    if (event.remindedKeys.includes(key)) continue;

    if (await pushToAll(sendPushFn, await eventMessage(event, occ, daysUntil)) > 0) {
      await markEventReminded(event.id, key);
      sent += 1;
    }
  }
  return { sent };
}

async function runTodoReminders(sendPushFn, now = new Date()) {
  const today = localToday(now);
  if (today.hour < reminderHour()) return { sent: 0 };

  let sent = 0;
  for (const todo of await listOpenTodos()) {
    if (!todo.dueDate) continue;
    const daysUntil = daysBetween(today, fromIso(todo.dueDate));
    if (!TODO_STAGES.includes(daysUntil)) continue;
    const key = `${todo.dueDate}:${daysUntil}`;
    if (todo.remindedKeys.includes(key)) continue;

    const text = daysUntil === 0
      ? `📌 วันนี้ครบกำหนด: ${todo.title}\nเสร็จแล้วพิมพ์ งาน เพื่อดูลิสต์ แล้วแตะ ✅`
      : `⏰ พรุ่งนี้ครบกำหนด: ${todo.title}`;
    if (await pushToAll(sendPushFn, text) > 0) {
      await markTodoReminded(todo.id, key);
      sent += 1;
    }
  }
  return { sent };
}

// ตารางอาจยังไม่ถูกสร้าง (ยังไม่รัน migration_012) → log แล้วข้าม ไม่ให้กระทบตัวรันแจ้งเตือนอื่น
async function runPlannerReminders(sendPushFn, now = new Date()) {
  const result = { events: 0, todos: 0 };
  try {
    result.events = (await runEventReminders(sendPushFn, now)).sent;
    result.todos = (await runTodoReminders(sendPushFn, now)).sent;
  } catch (error) {
    console.error('PLANNER_REMINDERS_FAILED', error?.message || error, '(ตรวจว่ารัน migration_012 แล้ว)');
  }
  return result;
}

module.exports = { runPlannerReminders, runEventReminders, runTodoReminders, stagesToSkipOnCreate, EVENT_STAGES, TODO_STAGES, reminderHour, __setGreetingWriter };
