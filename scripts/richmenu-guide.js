// สร้างภาพกริดช่วยออกแบบ Rich menu (assets/richmenu/guide-main.png, guide-more.png) จาก src/richmenu/definitions.js
// ต้องมี rsvg-convert (macOS: brew install librsvg) — ใช้เฉพาะตอนสร้างภาพแนะนำ ไม่ใช่ส่วนของเซิร์ฟเวอร์
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { buildRichMenus, BUTTONS, TAB_TITLES, WIDTH, HEIGHT, TAB_H, ROW_H, COL_W } = require('../src/richmenu/definitions');

const OUT = path.join(__dirname, '..', 'assets', 'richmenu');
const SAFE = 40; // ระยะปลอดภัยจากขอบปุ่ม
const FONT = "'Sukhumvit Set','Thonburi','Noto Sans Thai',sans-serif";
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;');
// ตัดอีโมจิออก (ฟอนต์ใน rsvg วาดเพี้ยน) — ไอคอนแนะนำอยู่ในตาราง docs/richmenu-design.md
const stripEmoji = (s) => String(s).replace(/[\p{Extended_Pictographic}\uFE0F]/gu, '').trim();

function svgFor(tab) {
  const menu = buildRichMenus()[tab];
  const parts = [`<svg xmlns="http://www.w3.org/2000/svg" width="${WIDTH}" height="${HEIGHT}" viewBox="0 0 ${WIDTH} ${HEIGHT}">`,
    `<rect width="${WIDTH}" height="${HEIGHT}" fill="#f4f6f8"/>`];

  // แถบแท็บ
  const tabs = ['main', 'more'];
  tabs.forEach((t, i) => {
    const x = (WIDTH / 2) * i;
    const active = t === tab;
    parts.push(`<rect x="${x}" y="0" width="${WIDTH / 2}" height="${TAB_H}" fill="${active ? '#06c755' : '#dfe3e8'}"/>`);
    parts.push(`<text x="${x + WIDTH / 4}" y="${TAB_H / 2 + 30}" font-family="${FONT}" font-size="86" font-weight="700" text-anchor="middle" fill="${active ? '#fff' : '#5b6670'}">${esc(TAB_TITLES[t])}</text>`);
  });

  // ปุ่ม
  BUTTONS[tab].forEach((button, i) => {
    const area = menu.areas[2 + i].bounds;
    parts.push(`<rect x="${area.x}" y="${area.y}" width="${area.width}" height="${area.height}" fill="#ffffff" stroke="#c4cbd2" stroke-width="6"/>`);
    parts.push(`<rect x="${area.x + SAFE}" y="${area.y + SAFE}" width="${area.width - SAFE * 2}" height="${area.height - SAFE * 2}" fill="none" stroke="#ff5a5f" stroke-width="3" stroke-dasharray="18 12"/>`);
    parts.push(`<text x="${area.x + area.width / 2}" y="${area.y + area.height / 2 - 20}" font-family="${FONT}" font-size="92" text-anchor="middle" fill="#9aa4ad">${esc(stripEmoji(button.title))}</text>`);
    parts.push(`<text x="${area.x + area.width / 2}" y="${area.y + area.height / 2 + 90}" font-family="${FONT}" font-size="54" text-anchor="middle" fill="#b8c0c7">${area.width}×${area.height} @ (${area.x},${area.y})</text>`);
  });
  parts.push('</svg>');
  return parts.join('\n');
}

fs.mkdirSync(OUT, { recursive: true });
for (const tab of ['main', 'more']) {
  const svgPath = path.join(OUT, `guide-${tab}.svg`);
  const pngPath = path.join(OUT, `guide-${tab}.png`);
  fs.writeFileSync(svgPath, svgFor(tab));
  execFileSync('rsvg-convert', ['-w', String(WIDTH), '-h', String(HEIGHT), '-o', pngPath, svgPath]);
  console.log(`✔ ${path.relative(process.cwd(), pngPath)} (${(fs.statSync(pngPath).size / 1024).toFixed(0)} KB)`);
}
