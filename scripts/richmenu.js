// จัดการ Rich menu ของ OA (ใช้ LINE_CHANNEL_ACCESS_TOKEN ของ environment ที่รัน — dev/prod ใช้ channel คนละตัว ต้องรันแยกกัน)
//   npm run richmenu:setup              สร้าง 2 แท็บ + อัปโหลดรูป + ตั้งเป็นเมนูเริ่มต้น (รันซ้ำได้ จะลบของเดิมที่เราสร้างไว้ก่อน)
//   npm run richmenu:setup -- --dry-run ตรวจรูป/โครงสร้างกับ LINE โดยไม่สร้างจริง
//   npm run richmenu:list               ดูเมนู/alias ที่มีอยู่
//   npm run richmenu:delete             ลบเมนู/alias ที่เราสร้างไว้ (ชื่อขึ้นต้น expense-bot:)
const fs = require('node:fs');
const path = require('node:path');
require('dotenv').config();
const { messagingApi } = require('@line/bot-sdk');
const { buildRichMenus, WIDTH, HEIGHT, NAME_PREFIX, ALIAS_MAIN, ALIAS_MORE } = require('../src/richmenu/definitions');

const IMAGE_DIR = path.join(__dirname, '..', 'assets', 'richmenu');
const IMAGES = { main: path.join(IMAGE_DIR, 'main.png'), more: path.join(IMAGE_DIR, 'more.png') };
const ALIASES = { main: ALIAS_MAIN, more: ALIAS_MORE };
const MAX_BYTES = 1024 * 1024;

// อ่านขนาดจาก header ของ PNG: signature 8 ไบต์ + IHDR (กว้าง/สูง ที่ไบต์ 16–23)
function inspectPng(file) {
  if (!fs.existsSync(file)) return { error: `ไม่พบไฟล์ ${path.relative(process.cwd(), file)}` };
  const buffer = fs.readFileSync(file);
  const isPng = buffer.length > 24 && buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
  if (!isPng) return { error: `${path.basename(file)} ไม่ใช่ไฟล์ PNG` };
  const width = buffer.readUInt32BE(16);
  const height = buffer.readUInt32BE(20);
  const problems = [];
  if (width !== WIDTH || height !== HEIGHT) problems.push(`ขนาด ${width}×${height} (ต้องเป็น ${WIDTH}×${HEIGHT})`);
  if (buffer.length > MAX_BYTES) problems.push(`ไฟล์ ${(buffer.length / 1024).toFixed(0)} KB เกิน 1 MB`);
  return problems.length ? { error: `${path.basename(file)}: ${problems.join(', ')}` } : { buffer, width, height };
}

function makeClients() {
  const channelAccessToken = process.env.LINE_CHANNEL_ACCESS_TOKEN;
  if (!channelAccessToken) throw new Error('ไม่พบ LINE_CHANNEL_ACCESS_TOKEN ใน environment');
  return {
    client: new messagingApi.MessagingApiClient({ channelAccessToken }),
    blob: new messagingApi.MessagingApiBlobClient({ channelAccessToken }),
  };
}

async function removeOurs(client) {
  const aliasList = await client.getRichMenuAliasList();
  for (const alias of aliasList.aliases || []) {
    if (Object.values(ALIASES).includes(alias.richMenuAliasId)) {
      await client.deleteRichMenuAlias(alias.richMenuAliasId);
      console.log(`  ลบ alias ${alias.richMenuAliasId}`);
    }
  }
  const list = await client.getRichMenuList();
  for (const menu of list.richmenus || []) {
    if (String(menu.name || '').startsWith(NAME_PREFIX)) {
      await client.deleteRichMenu(menu.richMenuId);
      console.log(`  ลบเมนู ${menu.name} (${menu.richMenuId})`);
    }
  }
}

async function setup({ dryRun }) {
  const images = {};
  const errors = [];
  for (const tab of Object.keys(IMAGES)) {
    const result = inspectPng(IMAGES[tab]);
    if (result.error) errors.push(result.error);
    else images[tab] = result.buffer;
  }
  if (errors.length) {
    console.error('รูป Rich menu ยังไม่พร้อม:\n - ' + errors.join('\n - '));
    console.error('\nดูสเปกที่ docs/richmenu-design.md (วางไฟล์ที่ assets/richmenu/main.png และ more.png)');
    process.exit(1);
  }

  const menus = buildRichMenus();
  const { client, blob } = makeClients();

  for (const [tab, menu] of Object.entries(menus)) {
    try {
      await client.validateRichMenuObject(menu);
      console.log(`✔ โครงสร้างเมนู "${tab}" ผ่านการตรวจของ LINE (${menu.areas.length} พื้นที่)`);
    } catch (err) {
      // alias ที่ richmenuswitch ชี้ไปอาจยังไม่ถูกสร้างตอนตรวจ — ถ้าเป็นกรณีนั้นให้เตือนแล้วไปต่อ (ตอนสร้างจริงจะตรวจอีกครั้ง)
      console.warn(`⚠ ตรวจเมนู "${tab}" ไม่ผ่านหรือรอ alias: ${err.message}`);
      if (!/alias/i.test(String(err.message))) process.exit(1);
    }
  }

  if (dryRun) {
    console.log('dry-run: ไม่ได้สร้างอะไรจริง');
    return;
  }

  console.log('ลบเมนูเดิมที่เราสร้างไว้ (ถ้ามี)…');
  await removeOurs(client);

  const ids = {};
  for (const tab of ['main', 'more']) {
    const { richMenuId } = await client.createRichMenu(menus[tab]);
    await blob.setRichMenuImage(richMenuId, new Blob([images[tab]], { type: 'image/png' }));
    ids[tab] = richMenuId;
    console.log(`✔ สร้างเมนู "${tab}" + อัปโหลดรูป (${richMenuId})`);
  }
  for (const tab of ['main', 'more']) {
    await client.createRichMenuAlias({ richMenuAliasId: ALIASES[tab], richMenuId: ids[tab] });
    console.log(`✔ alias ${ALIASES[tab]} → ${ids[tab]}`);
  }
  await client.setDefaultRichMenu(ids.main);
  console.log('✔ ตั้งหน้าหลักเป็นเมนูเริ่มต้นของ OA แล้ว');
}

async function list() {
  const { client } = makeClients();
  const [menus, aliases, def] = await Promise.all([
    client.getRichMenuList(),
    client.getRichMenuAliasList(),
    client.getDefaultRichMenuId().catch(() => null),
  ]);
  console.log('เมนูเริ่มต้น:', def?.richMenuId || '(ไม่มี)');
  for (const m of menus.richmenus || []) console.log(`- ${m.richMenuId}  ${m.name}  [${m.size.width}×${m.size.height}]${m.richMenuId === def?.richMenuId ? '  ← default' : ''}`);
  for (const a of aliases.aliases || []) console.log(`- alias ${a.richMenuAliasId} → ${a.richMenuId}`);
}

async function remove() {
  const { client } = makeClients();
  await client.cancelDefaultRichMenu().catch(() => {});
  await removeOurs(client);
  console.log('ลบแล้ว');
}

if (require.main === module) {
  const [command = 'setup'] = process.argv.slice(2).filter((a) => !a.startsWith('--'));
  const dryRun = process.argv.includes('--dry-run');
  const run = { setup: () => setup({ dryRun }), list, delete: remove }[command];
  if (!run) {
    console.error(`ไม่รู้จักคำสั่ง "${command}" (setup | list | delete)`);
    process.exit(1);
  }
  run().then(() => process.exit(0)).catch((err) => {
    console.error('ล้มเหลว:', err?.body ? JSON.stringify(err.body) : err.message);
    process.exit(1);
  });
}

module.exports = { inspectPng };
