// อ่านชื่อร้าน/พิกัดจากลิงก์ Google Maps (ไม่ใช้ API key): ตามลิงก์สั้น (maps.app.goo.gl) ไปยัง URL เต็มแล้วอ่านจาก
//   /maps/place/ชื่อร้าน/@lat,lng,17z/...   หรือ  !3dLAT!4dLNG  หรือ  ?q=lat,lng
// ไม่ได้ชื่อ → ลอง og:title ของหน้า → ไม่ได้อีกให้ผู้ใช้ระบุชื่อเอง
const { fetchPageTitle } = require('./fetch-title');

const MAPS_URL_RE = /https?:\/\/(?:www\.google\.[a-z.]+\/maps|maps\.app\.goo\.gl|goo\.gl\/maps|maps\.google\.[a-z.]+)[^\s]*/i;

const extractMapsLink = (text) => String(text).match(MAPS_URL_RE)?.[0] || null;

function cleanName(raw) {
  let name = String(raw || '');
  try { name = decodeURIComponent(name.replace(/\+/g, ' ')); } catch { /* ใช้ตามเดิม */ }
  return name.replace(/\s*[-–·|]\s*Google\s*(?:Maps|แผนที่).*$/i, '').replace(/\s+/g, ' ').trim();
}

function parsePlaceFromUrl(finalUrl) {
  const url = String(finalUrl || '');
  const name = cleanName(url.match(/\/maps\/place\/([^/@?]+)/)?.[1]);
  const at = url.match(/@(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)/);
  const bang = url.match(/!3d(-?\d+(?:\.\d+)?)!4d(-?\d+(?:\.\d+)?)/);
  const q = url.match(/[?&](?:q|query|ll)=(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)/);
  const c = bang || at || q;
  return { name: name || null, lat: c ? Number(c[1]) : null, lng: c ? Number(c[2]) : null };
}

async function resolveWithNetwork(url) {
  let finalUrl = url;
  try {
    const res = await fetch(url, { redirect: 'follow', signal: AbortSignal.timeout(6000), headers: { 'User-Agent': 'Mozilla/5.0' } });
    finalUrl = res.url || url;
  } catch { /* ใช้ URL เดิม */ }

  const place = parsePlaceFromUrl(finalUrl);
  if (!place.name) {
    const title = await fetchPageTitle(finalUrl);
    place.name = title ? cleanName(title) || null : null;
  }
  return { ...place, url: finalUrl.length <= 500 ? finalUrl : url };
}

let resolver = resolveWithNetwork;
function __setPlaceResolver(fn) { resolver = fn || resolveWithNetwork; } // test hook

const resolveMapsPlace = (url) => resolver(url);

module.exports = { extractMapsLink, parsePlaceFromUrl, resolveMapsPlace, __setPlaceResolver };
