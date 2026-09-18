const { getCarProfile, setCarProfile } = require('../../services/db');
const { searchEvStations } = require('../../services/places');
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

  // https://www.google.com/maps/dir/Origin/Stop1/Stop2/Destination/
  const dirPath = fullUrl.match(/maps\/dir\/([^?#\n]+)/)?.[1];
  if (dirPath) {
    const parts = dirPath.split('/').map((s) => decodeURIComponent(s.replace(/\+/g, ' ')).trim()).filter((s) => s && !s.startsWith('@'));
    if (parts.length >= 2) {
      return { origin: parts[0], destination: parts[parts.length - 1], waypoints: [] };
    }
  }

  // https://www.google.com/maps/dir/?api=1&origin=...&destination=...&waypoints=...
  // https://maps.google.com/maps?saddr=...&daddr=... (shortened link redirect format)
  // https://www.google.com/maps?q=... (place link — destination only, no origin)
  try {
    const u = new URL(fullUrl);

    // saddr/daddr format — daddr may contain multiple stops joined by " to:", take last
    const saddr = u.searchParams.get('saddr');
    const daddr = u.searchParams.get('daddr');
    if (saddr && daddr) {
      const dparts = daddr.split(/\s+to:/);
      return { origin: saddr, destination: dparts[dparts.length - 1].trim(), waypoints: [] };
    }

    // Standard ?origin=...&destination=...&waypoints=... format
    const origin = u.searchParams.get('origin');
    const destination = u.searchParams.get('destination');
    if (origin && destination) {
      const wps = u.searchParams.get('waypoints');
      const waypoints = wps ? wps.split('|').map((w) => w.trim()).filter(Boolean) : [];
      return { origin, destination, waypoints };
    }

    // Place link: q= param — destination only
    const q = u.searchParams.get('q');
    if (q) return { origin: null, destination: decodeURIComponent(q.replace(/\+/g, ' ')).trim(), waypoints: [] };
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
  if (!parsed || !parsed.origin) {
    return {
      type: 'error',
      reply: 'กรุณาแชร์ link เส้นทาง (Directions) ไม่ใช่ link สถานที่\nวิธีแชร์: เปิด Google Maps → กด เส้นทาง → แชร์ link',
    };
  }

  evRouteState.pendingByUser[lineUserId] = {
    type: 'link',
    origin: parsed.origin,
    destination: parsed.destination,
    waypoints: parsed.waypoints || [],
  };

  const routeLabel = [parsed.origin, ...(parsed.waypoints || []), parsed.destination].join(' → ');
  return {
    type: 'ev_awaiting_battery',
    reply: `พบเส้นทาง: ${routeLabel}\nแบตเหลือกี่ % ครับ? (เช่น 80%)`,
  };
}

// Called when user is in location-pending flow and sends a Maps link as destination
async function handleMapsDestinationForLocation(url, lineUserId) {
  const pending = evRouteState.pendingByUser[lineUserId];
  if (!pending || pending.type !== 'location') return null;

  const parsed = await parseMapsUrl(url);
  const destination = parsed?.destination || null;

  if (!destination) {
    return {
      type: 'error',
      reply: 'อ่านปลายทางจาก link ไม่ได้ กรุณาพิมพ์ชื่อปลายทาง เช่น หัวหิน 80%',
    };
  }

  pending.destination = destination;

  return {
    type: 'ev_awaiting_battery',
    reply: `ปลายทาง: ${destination}\nแบตเหลือกี่ % ครับ? (เช่น 80%)`,
  };
}

// Called when user sends a LINE location event
function handleLocationForEv(lat, lng, address, lineUserId) {
  const pending = evRouteState.pendingByUser[lineUserId];

  // If already waiting for destination, treat this location as destination
  if (pending?.type === 'location' && !pending.destination) {
    const destination = address ? `${address} (${lat},${lng})` : `${lat},${lng}`;
    pending.destination = destination;
    return {
      type: 'ev_awaiting_battery',
      reply: `ปลายทาง: ${address || `${lat},${lng}`}\nแบตเหลือกี่ % ครับ? (เช่น 80%)`,
    };
  }

  // Otherwise treat as origin
  const origin = address ? `${address} (${lat},${lng})` : `${lat},${lng}`;
  evRouteState.pendingByUser[lineUserId] = {
    type: 'location',
    origin,
    destination: null,
  };

  return {
    type: 'ev_awaiting_destination',
    reply: `บันทึกตำแหน่งปัจจุบันแล้ว\nจะไปที่ไหน?\nส่งตำแหน่ง, Maps link หรือพิมพ์ชื่อ + แบต% เช่น หัวหิน 80%`,
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

  const userWaypoints = pending.waypoints || [];
  const result = await searchEvStations(pending.origin, destination, batteryPct, car.max_range_km, userWaypoints);
  if (result.error) return { type: 'ev_route', reply: result.error };

  const { stations, originCoord, destCoord, canReachDest } = result;

  if (!stations.length) {
    return { type: 'ev_route', reply: 'แบตพอถึงปลายทาง ไม่มีจุดชาร์จบนเส้นทางนี้' };
  }

  // User waypoints (text) first, then charging stops (coords)
  const allWaypoints = [
    ...userWaypoints,
    ...stations.map((s) => `${s.lat},${s.lng}`),
  ].join('|');
  const routeUrl = `https://www.google.com/maps/dir/?api=1`
    + `&origin=${originCoord.lat},${originCoord.lng}`
    + `&destination=${destCoord.lat},${destCoord.lng}`
    + `&waypoints=${encodeURIComponent(allWaypoints)}`;

  const startLetter = 66 + userWaypoints.length; // B if no user waypoints
  const stationList = stations.map((s, i) => `${String.fromCharCode(startLetter + i)}. ${s.name}  ~${s.distKm}กม.`).join('\n');
  const stopLabel = stations.length === 1 ? 'แวะชาร์จ 1 จุด' : `แวะชาร์จ ${stations.length} จุด`;
  const warning = canReachDest ? '' : '\n⚠️ แบตอาจไม่พอถึงปลายทาง ควรชาร์จให้เต็มทุกจุด';

  return { type: 'ev_route', reply: `${stopLabel}${warning}\n${stationList}\n${routeUrl}` };
}

module.exports = { handleSetCarProfile, handleMapsLinkForEv, handleMapsDestinationForLocation, handleLocationForEv, handleEvBatteryReply, extractMapsUrl };
