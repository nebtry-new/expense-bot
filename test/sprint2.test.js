const test = require('node:test');
const assert = require('node:assert/strict');
const { handleTextMessage } = require('../src/handlers/text');
const { resetData, registerUser } = require('../src/services/db');
const { distanceKm, planChargingStops } = require('../src/services/ocm');

// ── OCM pure functions ──────────────────────────────────────────────

test('distanceKm returns ~0 for same coordinates', () => {
  const d = distanceKm(13.75, 100.5, 13.75, 100.5);
  assert.ok(d < 0.01);
});

test('distanceKm Bangkok → Hua Hin straight-line is roughly 145 km', () => {
  const d = distanceKm(13.75, 100.52, 12.57, 99.96);
  assert.ok(d > 120 && d < 170, `expected ~145km, got ${d.toFixed(1)}`);
});

test('planChargingStops filters out stations beyond safe range', () => {
  const originCoords = { lat: 13.75, lng: 100.52 };
  const stations = [
    { distFromOrigin: 50, numPoints: 8 },
    { distFromOrigin: 120, numPoints: 4 },
    { distFromOrigin: 200, numPoints: 10 },
  ];
  // battery 50%, max range 400km → safe range = (50-20)/100 * 400 = 120km
  const result = planChargingStops(stations, originCoords, 50, 400);
  assert.equal(result.length, 2);
  assert.equal(result[0].distFromOrigin, 50);
  assert.equal(result[1].distFromOrigin, 120);
});

test('planChargingStops returns empty when battery too low', () => {
  const originCoords = { lat: 13.75, lng: 100.52 };
  const stations = [{ distFromOrigin: 100, numPoints: 4 }];
  // battery 25%, max range 400km → safe range = (25-20)/100 * 400 = 20km
  const result = planChargingStops(stations, originCoords, 25, 400);
  assert.equal(result.length, 0);
});

test('planChargingStops returns max 3 stations', () => {
  const originCoords = { lat: 13.75, lng: 100.52 };
  const stations = Array.from({ length: 10 }, (_, i) => ({ distFromOrigin: 10 + i, numPoints: 4 }));
  const result = planChargingStops(stations, originCoords, 80, 400);
  assert.ok(result.length <= 3);
});

// ── Trip notebook ────────────────────────────────────────────────────

test('adds a place to a trip and lists it back', async () => {
  await resetData();
  await registerUser({ lineUserId: 'u1', displayName: 'A' });

  await handleTextMessage('สร้างทริป หัวหิน', { lineUserId: 'u1' });
  const add = await handleTextMessage('เพิ่มที่ ร้านต้มยำ #หัวหิน', { lineUserId: 'u1' });
  assert.equal(add.type, 'place_added');
  assert.ok(add.reply.includes('ร้านต้มยำ'));

  const list = await handleTextMessage('ที่เที่ยว หัวหิน', { lineUserId: 'u1' });
  assert.equal(list.type, 'trip_places');
  assert.ok(list.reply.includes('ร้านต้มยำ'));
});

test('rejects adding a place to a non-existent trip', async () => {
  await resetData();

  const result = await handleTextMessage('เพิ่มที่ ร้านอาหาร #ทริปผี', { lineUserId: 'u1' });
  assert.equal(result.type, 'error');
  assert.ok(result.reply.includes('ไม่พบทริป'));
});

test('rejects adding a place without a trip tag', async () => {
  await resetData();

  const result = await handleTextMessage('เพิ่มที่ ร้านอาหาร', { lineUserId: 'u1' });
  assert.equal(result.type, 'error');
  assert.ok(result.reply.includes('#'));
});

test('lists empty trip places with helpful prompt', async () => {
  await resetData();
  await registerUser({ lineUserId: 'u1', displayName: 'A' });
  await handleTextMessage('สร้างทริป เชียงใหม่', { lineUserId: 'u1' });

  const result = await handleTextMessage('ที่เที่ยว เชียงใหม่', { lineUserId: 'u1' });
  assert.equal(result.type, 'trip_places');
  assert.ok(result.reply.includes('ยังไม่มีสถานที่'));
});

// ── EV car profile ───────────────────────────────────────────────────

test('sets car profile and confirms the range', async () => {
  await resetData();

  const result = await handleTextMessage('ตั้งค่ารถ 400 กม.', { lineUserId: 'u1' });
  assert.equal(result.type, 'car_profile');
  assert.ok(result.reply.includes('400'));
});

test('Google Maps directions link triggers ev_awaiting_battery with parsed route', async () => {
  await resetData();

  const result = await handleTextMessage(
    'https://www.google.com/maps/dir/กรุงเทพ/หัวหิน/',
    { lineUserId: 'u1' }
  );
  assert.equal(result.type, 'ev_awaiting_battery');
  assert.ok(result.reply.includes('กรุงเทพ'));
  assert.ok(result.reply.includes('หัวหิน'));
});

test('battery reply returns error when car profile not set', async () => {
  await resetData();
  // set up pending state via Maps link
  await handleTextMessage('https://www.google.com/maps/dir/กรุงเทพ/หัวหิน/', { lineUserId: 'u1' });

  const result = await handleTextMessage('80%', { lineUserId: 'u1' });
  assert.equal(result.type, 'error');
  assert.ok(result.reply.includes('ตั้งค่ารถ'));
});

test('battery reply at or below 20% does not immediately reject — attempts emergency search', async () => {
  await resetData();
  await handleTextMessage('ตั้งค่ารถ 400 กม.', { lineUserId: 'u1' });
  await handleTextMessage('https://www.google.com/maps/dir/กรุงเทพ/หัวหิน/', { lineUserId: 'u1' });

  // Should attempt search (not block) — result may vary by API availability
  // Verify only that it does NOT return the "battery too low" early-exit error
  const result = await handleTextMessage('20%', { lineUserId: 'u1' }).catch(() => ({ type: 'ev_route', reply: '' }));
  assert.ok(!result.reply?.includes('ต่ำเกินไป'));
});

test('location flow: malformed destination+battery reply returns error', async () => {
  await resetData();
  const { evRouteState } = require('../src/handlers/state');
  evRouteState.pendingByUser['u1'] = { type: 'location', origin: '13.75,100.52', destination: null };

  const result = await handleTextMessage('ไปไหนก็ไม่รู้', { lineUserId: 'u1' });
  assert.equal(result.type, 'error');
  assert.ok(result.reply.includes('ปลายทาง'));
});
