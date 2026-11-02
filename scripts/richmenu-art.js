// วาดภาพ Rich menu จริง (assets/richmenu/main.png, more.png) จาก src/richmenu/definitions.js
// ข้อความไทยวาดด้วยฟอนต์ (ไม่ใช่ AI สร้างตัวอักษร) ไอคอนเป็น vector ไม่ใช้อีโมจิ
// ต้องมี rsvg-convert (macOS: brew install librsvg) — ใช้เฉพาะตอนสร้างภาพ ไม่ใช่ส่วนของเซิร์ฟเวอร์
//   node scripts/richmenu-art.js
//   RICHMENU_FONT="Garuda" node scripts/richmenu-art.js   (ถ้าติดตั้งฟอนต์อื่นไว้)
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { buildRichMenus, BUTTONS, TAB_TITLES, WIDTH, HEIGHT, TAB_H } = require('../src/richmenu/definitions');

const OUT = path.join(__dirname, '..', 'assets', 'richmenu');
const MAX_BYTES = 1024 * 1024; // LINE จำกัดภาพ Rich menu ไม่เกิน 1 MB
const FONT = `'${process.env.RICHMENU_FONT || 'Sarabun'}','Sarabun','Thonburi',sans-serif`;

// Mint + Cream + Brown
const C = {
  cream: '#FFF6E5',
  card: '#FFFDF7',
  mint: '#BFE8D4',
  mintDark: '#3FA882',
  mintLine: '#8FD3B6',
  brown: '#5C3D2E',
  brownSoft: '#A58B78',
  tabIdle: '#EADFC8',
  sand: '#F6D9A8', // ปุ่มเรื่องเงิน เน้นด้วยโทนคาราเมล
  caramel: '#C9822F',
};

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;');
const stripEmoji = (s) => String(s).replace(/[\p{Extended_Pictographic}️]/gu, '').trim();

// ไอคอนวาดในกรอบ -100..100 (จุดศูนย์กลางที่ 0,0)
const line = (w = 11) => `fill="none" stroke="${C.brown}" stroke-width="${w}" stroke-linecap="round" stroke-linejoin="round"`;
const S = line();
const ICONS = {
  record: () => `<rect x="-58" y="-70" width="100" height="130" rx="14" fill="${C.card}" ${S.replace('fill="none" ', '')}/>
    <path d="M-34 -32h52M-34 -6h52M-34 20h28" ${S}/>
    <path d="M62 -52l22 22-60 66-30 8 8-30z" fill="${C.mintDark}" stroke="${C.brown}" stroke-width="9" stroke-linejoin="round" transform="translate(-4 4) scale(.85)"/>`,
  summary: () => `<path d="M-70 70h140" ${S}/>
    <rect x="-56" y="0" width="30" height="62" rx="6" fill="${C.mintDark}" stroke="${C.brown}" stroke-width="9"/>
    <rect x="-15" y="-38" width="30" height="100" rx="6" fill="${C.card}" stroke="${C.brown}" stroke-width="9"/>
    <rect x="26" y="-74" width="30" height="136" rx="6" fill="${C.mintDark}" stroke="${C.brown}" stroke-width="9"/>`,
  money: () => `<path d="M-64 -26h112M26 -56l30 30-30 30" ${S}/>
    <path d="M64 28h-112M-26 -2l-30 30 30 30" ${S} transform="translate(0 4)"/>`,
  delete: () => `<path d="M-62 -52h124" ${S}/>
    <path d="M-22 -52v-22h44v22" ${S}/>
    <path d="M-48 -52l8 118a10 10 0 0 0 10 9h60a10 10 0 0 0 10-9l8-118z" fill="${C.card}" stroke="${C.brown}" stroke-width="11" stroke-linejoin="round"/>
    <path d="M-16 -16v58M16 -16v58" ${S}/>`,
  trip: () => `<path d="M-78 -8L82 -70 38 78 4 22z" fill="${C.card}" stroke="${C.brown}" stroke-width="11" stroke-linejoin="round"/>
    <path d="M82 -70L4 22l-4 52 -20 -42" ${S}/>`,
  ask: () => `<path d="M-70 -56h140a10 10 0 0 1 10 10v82a10 10 0 0 1-10 10H-6l-42 36v-36h-22a10 10 0 0 1-10-10v-82a10 10 0 0 1 10-10z" fill="${C.card}" stroke="${C.brown}" stroke-width="11" stroke-linejoin="round"/>
    <circle cx="-36" cy="-4" r="9" fill="${C.mintDark}"/><circle cx="0" cy="-4" r="9" fill="${C.mintDark}"/><circle cx="36" cy="-4" r="9" fill="${C.mintDark}"/>`,
  reminder: () => `<path d="M0 -76c-40 0-60 28-60 62v34l-16 22h152l-16-22v-34c0-34-20-62-60-62z" fill="${C.card}" stroke="${C.brown}" stroke-width="11" stroke-linejoin="round"/>
    <path d="M-20 62a20 20 0 0 0 40 0" ${S}/>
    <circle cx="0" cy="-84" r="9" fill="${C.mintDark}"/>`,
  reminders: () => `<rect x="-62" y="-66" width="124" height="142" rx="16" fill="${C.card}" stroke="${C.brown}" stroke-width="11"/>
    <rect x="-28" y="-82" width="56" height="30" rx="10" fill="${C.mintDark}" stroke="${C.brown}" stroke-width="9"/>
    <path d="M-38 -14l10 10 18-20M-38 32l10 10 18-20" ${line(10)}/>
    <path d="M6 -10h34M6 36h34" ${line(10)}/>`,
  ev: () => `<path d="M14 -84L-48 8h40l-18 76L52 -14H10z" fill="${C.mintDark}" stroke="${C.brown}" stroke-width="11" stroke-linejoin="round"/>`,
  car: () => `<path d="M-84 24v-30a16 16 0 0 1 12-15l24-8 22-28a16 16 0 0 1 12-6h48a16 16 0 0 1 13 7l20 27 27 8a14 14 0 0 1 10 14v31z" fill="${C.card}" stroke="${C.brown}" stroke-width="11" stroke-linejoin="round"/>
    <path d="M-30 -42l-14 26h54v-26zM22 -42v26h50l-18-26z" fill="${C.mint}" stroke="${C.brown}" stroke-width="7" stroke-linejoin="round"/>
    <circle cx="-48" cy="30" r="22" fill="${C.mintDark}" stroke="${C.brown}" stroke-width="10"/>
    <circle cx="52" cy="30" r="22" fill="${C.mintDark}" stroke="${C.brown}" stroke-width="10"/>`,
  monthly: () => `<rect x="-70" y="-56" width="140" height="130" rx="16" fill="${C.card}" stroke="${C.brown}" stroke-width="11"/>
    <path d="M-70 -14h140" ${S}/>
    <path d="M-34 -78v36M34 -78v36" ${S}/>
    <rect x="-44" y="12" width="26" height="22" rx="5" fill="${C.mintDark}"/><rect x="-13" y="12" width="26" height="22" rx="5" fill="${C.mintDark}"/><rect x="18" y="12" width="26" height="22" rx="5" fill="${C.mintDark}"/>
    <rect x="-44" y="44" width="26" height="18" rx="5" fill="${C.mintLine}"/><rect x="-13" y="44" width="26" height="18" rx="5" fill="${C.mintLine}"/>`,
  help: () => `<circle cx="0" cy="0" r="74" fill="${C.card}" stroke="${C.brown}" stroke-width="11"/>
    <path d="M-26 -24a26 26 0 1 1 40 22c-10 7-14 12-14 24" ${S}/>
    <circle cx="0" cy="52" r="8" fill="${C.mintDark}"/>`,
};

const CELL_INSET = 26; // ระยะการ์ดจากขอบปุ่ม (ภายในเขตปลอดภัย 40 px ของตัวอักษร/ไอคอน)

function svgFor(tab) {
  const menu = buildRichMenus()[tab];
  const p = [`<svg xmlns="http://www.w3.org/2000/svg" width="${WIDTH}" height="${HEIGHT}" viewBox="0 0 ${WIDTH} ${HEIGHT}">`,
    `<rect width="${WIDTH}" height="${HEIGHT}" fill="${C.cream}"/>`];

  // แถบแท็บ: แท็บที่เปิดอยู่เป็นสีเขียวเข้ม ตัวครีม อีกแท็บจาง
  ['main', 'more'].forEach((t, i) => {
    const x = (WIDTH / 2) * i;
    const active = t === tab;
    p.push(`<rect x="${x}" y="0" width="${WIDTH / 2}" height="${TAB_H}" fill="${active ? C.mintDark : C.tabIdle}"/>`);
    p.push(`<text x="${x + WIDTH / 4}" y="${TAB_H / 2 + 31}" font-family="${FONT}" font-size="88" font-weight="700" text-anchor="middle" fill="${active ? C.cream : C.brownSoft}">${esc(TAB_TITLES[t])}</text>`);
  });
  p.push(`<rect x="0" y="${TAB_H - 6}" width="${WIDTH}" height="6" fill="${C.mintLine}"/>`);

  BUTTONS[tab].forEach((button, i) => {
    const a = menu.areas[2 + i].bounds;
    const key = button.key;
    const money = key === 'money';
    const x = a.x + CELL_INSET;
    const y = a.y + CELL_INSET;
    const w = a.width - CELL_INSET * 2;
    const h = a.height - CELL_INSET * 2;
    const cx = a.x + a.width / 2;
    p.push(`<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="56" fill="${money ? '#FFF1D6' : C.card}" stroke="${money ? C.caramel : C.mintLine}" stroke-width="8"/>`);
    p.push(`<circle cx="${cx}" cy="${a.y + 284}" r="172" fill="${money ? C.sand : C.mint}"/>`);
    p.push(`<g transform="translate(${cx} ${a.y + 284}) scale(1.3)">${ICONS[key]()}</g>`);
    p.push(`<text x="${cx}" y="${a.y + 618}" font-family="${FONT}" font-size="100" font-weight="700" text-anchor="middle" fill="${C.brown}">${esc(stripEmoji(button.title))}</text>`);
  });
  p.push('</svg>');
  return p.join('\n');
}

fs.mkdirSync(OUT, { recursive: true });
for (const tab of ['main', 'more']) {
  const svg = svgFor(tab);
  const svgPath = path.join(OUT, `art-${tab}.svg`);
  const pngPath = path.join(OUT, `${tab}.png`);
  fs.writeFileSync(svgPath, svg);
  execFileSync('rsvg-convert', ['-w', String(WIDTH), '-h', String(HEIGHT), '-o', pngPath, svgPath]);
  const kb = fs.statSync(pngPath).size / 1024;
  console.log(`${kb * 1024 > MAX_BYTES ? '✖ เกิน 1 MB' : '✔'} ${path.relative(process.cwd(), pngPath)} (${kb.toFixed(0)} KB)`);
}
