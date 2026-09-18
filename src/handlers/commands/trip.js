const { createTrip, getTrips, getExpensesByTrip, findTripByName, getUsers, addTripPlace, getTripPlaces, markTripPlaceVisited, addTripNote, getTripNotes } = require('../../services/db');
const { fetchPageTitle } = require('../../utils/fetch-title');
const { calculateBalances } = require('../../utils/balance');
const { parseTripCreation, formatSplitMode } = require('../../utils/parser');
const { buildSettlementNotification } = require('./settlement');
const { settlementState } = require('../state');

const CATEGORY_KEYWORDS = ['กิน', 'ที่พัก', 'เที่ยว', 'ช้อป'];
const CATEGORY_LABELS = {
  กิน: '🍽 กิน',
  ที่พัก: '🏨 ที่พัก',
  เที่ยว: '🏖 เที่ยว',
  ช้อป: '🛍 ช้อป',
  other: '📍 อื่นๆ',
};

function parseAddPlaceInput(input) {
  const tagMatch = input.match(/#([฀-๿a-zA-Z0-9_]+)/);
  if (!tagMatch) return null;
  const tripName = tagMatch[1];
  let rest = input.replace(/#[฀-๿a-zA-Z0-9_]+/, '').trim();

  // Extract URL
  const urlMatch = rest.match(/https?:\/\/\S+/);
  const mapsUrl = urlMatch ? urlMatch[0] : null;
  if (mapsUrl) rest = rest.replace(urlMatch[0], '').trim();

  // Split on | — before = name, after = notes
  const parts = rest.split('|');
  let namePart = parts[0].trim();
  let notesPart = parts.length > 1 ? parts.slice(1).join('|').trim() : '';

  // Extract category from name part first, then notes part
  let category = 'other';
  for (const kw of CATEGORY_KEYWORDS) {
    if (namePart.includes(kw)) {
      category = kw;
      namePart = namePart.replace(kw, '').trim();
      break;
    }
    if (notesPart.includes(kw)) {
      category = kw;
      notesPart = notesPart.replace(kw, '').trim();
      break;
    }
  }

  return { tripName, name: namePart, notes: notesPart || null, category, mapsUrl };
}

async function handleCreateTrip(input) {
  const { name, defaultSplitMode, defaultNumPeople } = parseTripCreation(input);

  const existing = await findTripByName(name);
  if (existing) {
    return { type: 'trip_exists', reply: `มีทริป "${name}" อยู่แล้ว` };
  }

  const trip = await createTrip(name, defaultSplitMode, defaultNumPeople);
  const splitLabel = formatSplitMode(defaultSplitMode, defaultNumPeople);
  return {
    type: 'trip_created',
    trip,
    reply: `สร้างทริป "${name}" แล้ว (ค่าเริ่มต้น: ${splitLabel})\nบันทึกค่าใช้จ่ายด้วย #${name} ท้ายข้อความ\nเช่น ค่าโรงแรม 1200 #${name}`,
  };
}

async function handleListTrips() {
  const allTrips = await getTrips();
  if (!allTrips.length) {
    return { type: 'trips', reply: 'ยังไม่มีทริป สร้างทริปได้ด้วย: สร้างทริป (ชื่อ)' };
  }

  const lines = allTrips.map((t, i) => `${i + 1}. ${t.name}`);
  return { type: 'trips', reply: `ทริปทั้งหมด:\n${lines.join('\n')}` };
}

async function handleTripSummary(name) {
  const trip = await findTripByName(name);
  if (!trip) {
    return { type: 'error', reply: `ไม่พบทริป "${name}"` };
  }

  const tripExpenses = await getExpensesByTrip(trip.id);
  if (!tripExpenses.length) {
    return { type: 'trip_summary', reply: `ทริป "${trip.name}" ยังไม่มีค่าใช้จ่าย` };
  }

  const users = await getUsers();
  const total = tripExpenses.reduce((sum, e) => sum + Number(e.amount || 0), 0);
  const balances = calculateBalances(tripExpenses, users);
  const formatAmount = (v) => Math.abs(v).toFixed(2);

  const lines = [`สรุปทริป "${trip.name}"`, `รวม: ${total.toLocaleString()} บาท (${tripExpenses.length} รายการ)`];

  let notification = null;
  if (users.length === 2) {
    const [a, b] = users;
    const balA = Number(balances[String(a.id)] ?? 0);
    const balB = Number(balances[String(b.id)] ?? 0);
    if (balA !== 0 || balB !== 0) {
      if (balA >= 0 && balB <= 0) {
        lines.push(`${b.displayName} ต้องจ่ายคืน ${a.displayName} ${formatAmount(balB)} บาท`);
      } else if (balB >= 0 && balA <= 0) {
        lines.push(`${a.displayName} ต้องจ่ายคืน ${b.displayName} ${formatAmount(balA)} บาท`);
      }
      notification = buildSettlementNotification(balances, users);
    }
  }

  const itemLines = tripExpenses.map((e) => `• ${e.description} ${Number(e.amount).toLocaleString()} บาท`);
  lines.push('', ...itemLines);

  const prompt = notification ? '\n\nต้องการเรียกเก็บเงินเลยไหม? พิมพ์ ใช่ หรือ เรียกเก็บเงิน' : '';

  if (notification?.creditorLineUserId) {
    settlementState.pendingByUser[notification.creditorLineUserId] = notification;
  }

  return { type: 'trip_summary', reply: lines.join('\n') + prompt, notification };
}

async function handleAddPlace(input) {
  const parsed = parseAddPlaceInput(input);
  if (!parsed) {
    return { type: 'error', reply: 'ระบุทริปด้วย #ชื่อทริป เช่น เพิ่มที่ ร้านต้มยำ #หัวหิน' };
  }

  let { tripName, notes, category, mapsUrl } = parsed;
  let { name } = parsed;

  // Auto-fetch title from URL when no name given
  if (!name && mapsUrl) {
    const fetched = await fetchPageTitle(mapsUrl);
    if (fetched) {
      name = fetched;
    } else {
      return { type: 'error', reply: 'อ่านชื่อจาก link ไม่ได้ กรุณาพิมพ์ชื่อด้วย เช่น เพิ่มที่ ร้านต้มยำ | https://...' };
    }
  }

  if (!name) {
    return { type: 'error', reply: 'ระบุชื่อสถานที่ด้วย เช่น เพิ่มที่ ร้านต้มยำ #หัวหิน' };
  }

  const trip = await findTripByName(tripName);
  if (!trip) {
    return { type: 'error', reply: `ไม่พบทริป "#${tripName}" สร้างก่อนด้วย: สร้างทริป ${tripName}` };
  }

  await addTripPlace(trip.id, name, notes, category, mapsUrl);

  const catLabel = CATEGORY_LABELS[category] || CATEGORY_LABELS.other;
  const lines = [`เพิ่ม "${name}" ในทริป ${trip.name} แล้ว`, `หมวด: ${catLabel}`];
  if (notes) lines.push(`📝 ${notes}`);
  if (mapsUrl) lines.push('📍 บันทึก link แผนที่แล้ว');
  return { type: 'place_added', reply: lines.join('\n') };
}

async function handleMarkVisited(input) {
  const tagMatch = input.match(/#([฀-๿a-zA-Z0-9_]+)/);
  if (!tagMatch) {
    return { type: 'error', reply: 'ระบุทริปด้วย #ชื่อทริป เช่น ไปแล้ว ร้านต้มยำ #หัวหิน' };
  }
  const tripName = tagMatch[1];
  const placeName = input.replace(/#[฀-๿a-zA-Z0-9_]+/, '').trim();
  if (!placeName) return { type: 'error', reply: 'ระบุชื่อสถานที่ด้วย' };

  const trip = await findTripByName(tripName);
  if (!trip) return { type: 'error', reply: `ไม่พบทริป "${tripName}"` };

  const place = await markTripPlaceVisited(trip.id, placeName);
  if (!place) return { type: 'error', reply: `ไม่พบ "${placeName}" ในทริป ${trip.name}` };

  return { type: 'place_visited', reply: `✅ "${place.name}" บันทึกว่าไปแล้ว` };
}

async function handleListPlaces(tripName) {
  const trip = await findTripByName(tripName.trim());
  if (!trip) {
    return { type: 'error', reply: `ไม่พบทริป "${tripName}"` };
  }

  const places = await getTripPlaces(trip.id);
  if (!places.length) {
    return { type: 'trip_places', reply: `ทริป "${trip.name}" ยังไม่มีสถานที่ เพิ่มด้วย: เพิ่มที่ [ชื่อ] #${trip.name}` };
  }

  const visitedCount = places.filter((p) => (p.status || 'pending') === 'visited').length;

  const groups = {};
  for (const p of places) {
    const cat = p.category || 'other';
    if (!groups[cat]) groups[cat] = [];
    groups[cat].push(p);
  }

  const catOrder = ['กิน', 'เที่ยว', 'ที่พัก', 'ช้อป', 'other'];
  const lines = [`สถานที่ในทริป "${trip.name}" (${places.length} ที่ / ไปแล้ว ${visitedCount})\n`];

  for (const cat of catOrder) {
    if (!groups[cat]) continue;
    lines.push(CATEGORY_LABELS[cat] || cat);
    for (const p of groups[cat]) {
      const icon = p.status === 'visited' ? '✅' : '⬜';
      lines.push(`${icon} ${p.name}`);
      if (p.notes) lines.push(`   📝 ${p.notes}`);
      if (p.maps_url) lines.push(`   📍 ${p.maps_url}`);
    }
    lines.push('');
  }

  return { type: 'trip_places', reply: lines.join('\n').trim() };
}

async function handleTripRoute(tripName) {
  const trip = await findTripByName(tripName.trim());
  if (!trip) return { type: 'error', reply: `ไม่พบทริป "${tripName}"` };

  const places = await getTripPlaces(trip.id);
  if (!places.length) return { type: 'error', reply: `ทริป "${trip.name}" ยังไม่มีสถานที่` };

  const waypoints = places.map((p) => {
    if (p.maps_url) {
      const m = p.maps_url.match(/@?(-?\d{1,3}\.\d+),(-?\d{1,3}\.\d+)/);
      if (m) return `${m[1]},${m[2]}`;
    }
    return p.name;
  });

  if (waypoints.length === 1) {
    return {
      type: 'trip_route',
      reply: `เส้นทางทริป "${trip.name}" (1 จุด)\nhttps://www.google.com/maps/search/?api=1&query=${encodeURIComponent(waypoints[0])}`,
    };
  }

  const origin = encodeURIComponent(waypoints[0]);
  const destination = encodeURIComponent(waypoints[waypoints.length - 1]);
  const middle = waypoints.slice(1, -1).map((w) => encodeURIComponent(w));
  let url = `https://www.google.com/maps/dir/?api=1&origin=${origin}&destination=${destination}`;
  if (middle.length) url += `&waypoints=${middle.join('|')}`;

  return { type: 'trip_route', reply: `เส้นทางทริป "${trip.name}" (${places.length} จุด)\n${url}` };
}

async function handleAddNote(input) {
  const tagMatch = input.match(/#([฀-๿a-zA-Z0-9_]+)/);
  if (!tagMatch) {
    return { type: 'error', reply: 'ระบุทริปด้วย #ชื่อทริป เช่น โน้ตทริป เบอร์โรงแรม 032-XXXX #หัวหิน' };
  }
  const tripName = tagMatch[1];
  const content = input.replace(/#[฀-๿a-zA-Z0-9_]+/, '').trim();
  if (!content) return { type: 'error', reply: 'ระบุเนื้อหา note ด้วย' };

  const trip = await findTripByName(tripName);
  if (!trip) return { type: 'error', reply: `ไม่พบทริป "${tripName}" สร้างก่อนด้วย: สร้างทริป ${tripName}` };

  await addTripNote(trip.id, content);
  return { type: 'note_added', reply: `📝 บันทึก note ในทริป ${trip.name} แล้ว` };
}

async function handleListNotes(tripName) {
  const trip = await findTripByName(tripName.trim());
  if (!trip) return { type: 'error', reply: `ไม่พบทริป "${tripName}"` };

  const notes = await getTripNotes(trip.id);
  if (!notes.length) {
    return { type: 'trip_notes', reply: `ทริป "${trip.name}" ยังไม่มี note\nเพิ่มด้วย: โน้ตทริป [ข้อความ] #${trip.name}` };
  }

  const lines = [`📋 Note ทริป "${trip.name}"\n`, ...notes.map((n, i) => `${i + 1}. ${n.content}`)];
  return { type: 'trip_notes', reply: lines.join('\n') };
}

module.exports = { handleCreateTrip, handleListTrips, handleTripSummary, handleAddPlace, handleMarkVisited, handleListPlaces, handleTripRoute, handleAddNote, handleListNotes };
