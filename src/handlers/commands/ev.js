const { getCarProfile, setCarProfile } = require('../../services/db');
const { searchEvStations } = require('../../services/claude');
const { evRouteState } = require('../state');

// Parse Google Maps directions URL → { origin, destination } | null
async function parseMapsUrl(url) {
  let fullUrl = url;

  // Follow redirect for shortened links (maps.app.goo.gl, goo.gl/maps)
  if (/maps\.app\.goo\.gl|goo\.gl\/maps/.test(url)) {
    try {
      const res = await fetch(url, { redirect: 'follow' });
      fullUrl = res.url;
    } catch {
      return null;
    }
  }

  // https://www.google.com/maps/dir/Origin/Destination/
  const dirMatch = fullUrl.match(/maps\/dir\/([^/?#\n]+)\/([^/?#\n]+)/);
  if (dirMatch) {
    const origin = decodeURIComponent(dirMatch[1].replace(/\+/g, ' ')).trim();
    const destination = decodeURIComponent(dirMatch[2].replace(/\+/g, ' ')).trim();
    if (origin && destination && origin !== '@') {
      return { origin, destination };
    }
  }

  // https://www.google.com/maps/dir/?api=1&origin=...&destination=...
  // https://maps.google.com/maps?saddr=...&daddr=... (shortened link redirect format)
  try {
    const u = new URL(fullUrl);
    const origin = u.searchParams.get('origin') || u.searchParams.get('saddr');
    const destination = u.searchParams.get('destination') || u.searchParams.get('daddr');
    if (origin && destination) return { origin, destination };
  } catch {
    // ignore
  }

  return null;
}

// Detect Google Maps URL in a message
function extractMapsUrl(text) {
  const m = text.match(/https?:\/\/(www\.google\.com\/maps|maps\.app\.goo\.gl|goo\.gl\/maps)[^\s]*/);
  return m ? m[0] : null;
}

// "ตั้งค่ารถ 400 กม."
async function handleSetCarProfile(input) {
  const m = input.match(/(\d+)/);
  if (!m) return { type: 'error', reply: 'ระบุระยะทางในหน่วย กม. เช่น ตั้งค่ารถ 400 กม.' };
  const maxRangeKm = parseInt(m[1], 10);
  await setCarProfile(maxRangeKm);
  return { type: 'car_profile', reply: `บันทึกแล้ว รถวิ่งได้ ${maxRangeKm} กม./ชาร์จ` };
}

// Called when user sends a Google Maps directions link
async function handleMapsLinkForEv(url, lineUserId) {
  const parsed = await parseMapsUrl(url);
  if (!parsed) {
    return {
      type: 'error',
      reply: 'กรุณาแชร์ link เส้นทาง (Directions) ไม่ใช่ link สถานที่\nวิธีแชร์: เปิด Google Maps → กด เส้นทาง → แชร์ link',
    };
  }

  evRouteState.pendingByUser[lineUserId] = {
    type: 'link',
    origin: parsed.origin,
    destination: parsed.destination,
  };

  return {
    type: 'ev_awaiting_battery',
    reply: `พบเส้นทาง: ${parsed.origin} → ${parsed.destination}\nแบตเหลือกี่ % ครับ? (เช่น 80%)`,
  };
}

// Called when user sends a LINE location event
function handleLocationForEv(lat, lng, address, lineUserId) {
  const origin = address ? `${address} (${lat},${lng})` : `${lat},${lng}`;
  evRouteState.pendingByUser[lineUserId] = {
    type: 'location',
    origin,
    destination: null,
  };

  return {
    type: 'ev_awaiting_destination',
    reply: `บันทึกตำแหน่งปัจจุบันแล้ว\nจะไปที่ไหน และแบตเหลือกี่ %?\nเช่น หัวหิน 80%`,
  };
}

// Called when user replies with battery % (and optionally destination for location flow)
async function handleEvBatteryReply(text, lineUserId) {
  const pending = evRouteState.pendingByUser[lineUserId];
  if (!pending) return null;

  let destination = pending.destination;
  let batteryPct;

  if (pending.type === 'location' && !destination) {
    // expect "หัวหิน 80%" or "ไป หัวหิน 80%"
    const m = text.match(/^(?:ไป\s+)?(.+?)\s+(\d+)%?$/);
    if (!m) return { type: 'error', reply: 'พิมพ์ปลายทางและแบต เช่น หัวหิน 80%' };
    destination = m[1].trim();
    batteryPct = parseInt(m[2], 10);
  } else {
    // expect "80%" or "80"
    const m = text.match(/^(\d+)%?$/);
    if (!m) return null;
    batteryPct = parseInt(m[1], 10);
  }

  const car = await getCarProfile();
  if (!car) {
    delete evRouteState.pendingByUser[lineUserId];
    return { type: 'error', reply: 'ยังไม่ได้ตั้งค่ารถ พิมพ์: ตั้งค่ารถ [ระยะทาง] กม.\nเช่น ตั้งค่ารถ 400 กม.' };
  }

  delete evRouteState.pendingByUser[lineUserId];

  const result = await searchEvStations(pending.origin, destination, batteryPct, car.max_range_km);
  return { type: 'ev_route', reply: result };
}

module.exports = { handleSetCarProfile, handleMapsLinkForEv, handleLocationForEv, handleEvBatteryReply, extractMapsUrl };
