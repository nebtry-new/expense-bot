// ประเมินคุณภาพการตีความด้วยโมเดลจริง (ใช้เครดิต API) — รัน: npm run eval:nl
const cases = require('../test/golden/nl-sentences.json');
const { runCase } = require('./golden-runner');

(async () => {
  if (!process.env.ANTHROPIC_API_KEY) {
    console.error('ต้องตั้ง ANTHROPIC_API_KEY ใน .env');
    process.exit(1);
  }
  let pass = 0;
  const selected = cases.filter((c) => c.needsModel);
  for (const c of selected) {
    const { failures, reply } = await runCase(c, { useModel: true });
    if (!failures.length) pass++;
    console.log(`${failures.length ? '✖' : '✔'} ${c.text}${failures.length ? `\n   ${failures.join('\n   ')}\n   ตอบ: ${String(reply).split('\n')[0]}` : ''}`);
  }
  console.log(`\nผ่าน ${pass}/${selected.length}`);
  process.exit(pass === selected.length ? 0 : 2);
})();
