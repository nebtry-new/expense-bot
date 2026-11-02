// ดึง nl_message_log ออกมาวิเคราะห์ (เฟสถัดไป): node scripts/export-nl-log.js [--limit 1000] > nl-log.jsonl
// - stdout: JSONL หนึ่งบรรทัดต่อข้อความ พร้อม deleted=true ถ้ารายการที่บันทึกถูกลบทิ้งภายหลัง (สัญญาณว่าตีความผิด)
// - stderr: สรุปจำนวนตาม route / outcome / reason
// ต้องมี SUPABASE_URL + SUPABASE_SECRET_KEY และ DEVELOPMENT_MODE ไม่เป็น true
const { listNlMessages, getExpenses, getDbStatus } = require('../src/services/db');

(async () => {
  const limitArg = process.argv.indexOf('--limit');
  const limit = limitArg > -1 ? Number(process.argv[limitArg + 1]) || 1000 : 1000;

  const [rows, expenses] = await Promise.all([listNlMessages({ limit }), getExpenses()]);
  const existing = new Set(expenses.map((e) => String(e.id)));

  const tally = {};
  const bump = (key) => { tally[key] = (tally[key] || 0) + 1; };

  for (const row of rows) {
    const ids = row.expense_ids || [];
    const deleted = row.outcome === 'saved' && ids.length > 0 && ids.some((id) => !existing.has(String(id)));
    bump(`route=${row.route}`);
    bump(`outcome=${row.outcome}`);
    if (row.reason) bump(`reason=${row.reason}`);
    if (deleted) bump('deleted_after_save');
    process.stdout.write(`${JSON.stringify({ ...row, deleted })}\n`);
  }

  console.error(`DB: ${JSON.stringify(getDbStatus())}`);
  console.error(`ข้อความทั้งหมด ${rows.length}`);
  for (const [key, count] of Object.entries(tally).sort()) console.error(`  ${key}: ${count}`);
  process.exit(0);
})().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
