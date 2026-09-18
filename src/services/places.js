const apiKey = process.env.GOOGLE_PLACES_API_KEY;

function haversineKm(a, b) {
  const R = 6371;
  const dLat = (b.lat - a.lat) * (Math.PI / 180);
  const dLng = (b.lng - a.lng) * (Math.PI / 180);
  const h = Math.sin(dLat / 2) ** 2
    + Math.cos(a.lat * (Math.PI / 180)) * Math.cos(b.lat * (Math.PI / 180)) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.asin(Math.sqrt(h));
}

// Perpendicular distance from point to line segment A→B (km)
function distToSegmentKm(point, a, b) {
  const dx = b.lat - a.lat;
  const dy = b.lng - a.lng;
  const len2 = dx * dx + dy * dy;
  if (len2 === 0) return haversineKm(point, a);
  const t = Math.max(0, Math.min(1, ((point.lat - a.lat) * dx + (point.lng - a.lng) * dy) / len2));
  return haversineKm(point, { lat: a.lat + t * dx, lng: a.lng + t * dy });
}

// Minimum distance from point to actual route (list of waypoint segments)
function distToRouteKm(point, waypoints) {
  let min = Infinity;
  for (let i = 0; i < waypoints.length - 1; i++) {
    const d = distToSegmentKm(point, waypoints[i], waypoints[i + 1]);
    if (d < min) min = d;
  }
  return min;
}

function interpolate(a, b, t) {
  return { lat: a.lat + (b.lat - a.lat) * t, lng: a.lng + (b.lng - a.lng) * t };
}

// Fetch actual road route waypoints and distance from Google Directions API
async function getRouteWaypoints(originCoord, destCoord) {
  const url = `https://maps.googleapis.com/maps/api/directions/json`
    + `?origin=${originCoord.lat},${originCoord.lng}`
    + `&destination=${destCoord.lat},${destCoord.lng}`
    + `&key=${apiKey}`;
  try {
    const res = await fetch(url);
    const data = await res.json();
    if (data.status !== 'OK') {
      console.error('Directions API failed:', data.status);
      return null;
    }
    const waypoints = [{ lat: originCoord.lat, lng: originCoord.lng }];
    for (const leg of data.routes[0].legs) {
      for (const step of leg.steps) {
        waypoints.push({ lat: step.end_location.lat, lng: step.end_location.lng });
      }
    }
    const routeDistanceKm = data.routes[0].legs.reduce((sum, l) => sum + l.distance.value, 0) / 1000;
    return { waypoints, routeDistanceKm };
  } catch (err) {
    console.error('Directions API error:', err.message);
    return null;
  }
}

async function geocodeText(text) {
  const m = text.match(/\(?\s*(-?\d{1,3}\.\d+)\s*,\s*(-?\d{1,3}\.\d+)\s*\)?/);
  if (m) return { lat: parseFloat(m[1]), lng: parseFloat(m[2]) };

  const url = `https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(text)}&key=${apiKey}`;
  const res = await fetch(url);
  const data = await res.json();
  if (data.status !== 'OK') {
    console.error('Geocoding failed:', { text, status: data.status, error: data.error_message });
    return null;
  }
  const loc = data.results?.[0]?.geometry?.location;
  return loc ? { lat: loc.lat, lng: loc.lng } : null;
}

async function placesNearby(lat, lng, radiusM) {
  const res = await fetch('https://places.googleapis.com/v1/places:searchNearby', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Goog-Api-Key': apiKey,
      'X-Goog-FieldMask': 'places.displayName,places.location,places.rating,places.id,places.shortFormattedAddress',
    },
    body: JSON.stringify({
      includedTypes: ['electric_vehicle_charging_station'],
      locationRestriction: {
        circle: { center: { latitude: lat, longitude: lng }, radius: radiusM },
      },
      maxResultCount: 10,
    }),
  });
  const data = await res.json();
  if (data.error) {
    console.error('Places API v1 error:', data.error);
    return [];
  }
  return data.places || [];
}

// Greedy multi-hop: find minimum charging stops from origin to destination
function planChargingStops(stations, originCoord, destCoord, reachableKm, maxRangeKm) {
  const stops = [];
  let pos = originCoord;
  let range = reachableKm;
  const used = new Set();

  while (haversineKm(pos, destCoord) > range && stops.length < 5) {
    const reachable = stations.filter((s) => !used.has(s.placeId) && haversineKm(pos, s) <= range);
    if (!reachable.length) break;

    // Prefer >50% of current range (worth stopping), sort by rating then furthest first
    const half = range * 0.5;
    const preferred = reachable.filter((s) => haversineKm(pos, s) >= half);
    const pool = preferred.length ? preferred : reachable;
    pool.sort((a, b) => b.rating - a.rating || haversineKm(pos, b) - haversineKm(pos, a));

    const best = pool[0];
    used.add(best.placeId);
    stops.push(best);
    pos = { lat: best.lat, lng: best.lng };
    range = maxRangeKm; // full charge after stop
  }

  const canReachDest = haversineKm(pos, destCoord) <= range;
  return { stops, canReachDest };
}

async function searchEvStations(originText, destText, batteryPct, maxRangeKm) {
  if (!apiKey) return { error: 'ไม่ได้ตั้งค่า GOOGLE_PLACES_API_KEY' };

  const [originCoord, destCoord] = await Promise.all([
    geocodeText(originText),
    geocodeText(destText),
  ]);
  if (!originCoord) return { error: 'หาตำแหน่งต้นทางไม่ได้ กรุณาลองใหม่' };
  if (!destCoord) return { error: 'หาตำแหน่งปลายทางไม่ได้ กรุณาลองใหม่' };

  const reachableKm = (batteryPct / 100) * maxRangeKm;
  const straightKm = haversineKm(originCoord, destCoord);

  // Fetch actual road route for accurate corridor check and distance
  const routeData = await getRouteWaypoints(originCoord, destCoord);
  const routeKm = routeData?.routeDistanceKm ?? straightKm;
  const routeWaypoints = routeData?.waypoints ?? null;

  const radiusM = Math.min(50000, Math.max(15000, Math.round(routeKm * 1000 * 0.25)));
  const numPoints = Math.min(8, Math.max(3, Math.ceil(routeKm / 80)));

  console.log('EV search:', { routeKm: routeKm.toFixed(1), radiusM, reachableKm: reachableKm.toFixed(1), numPoints, usingRoadRoute: !!routeWaypoints });

  // Spread search points evenly along the straight-line A→B path
  const midpoints = Array.from({ length: numPoints }, (_, i) =>
    interpolate(originCoord, destCoord, (i + 1) / (numPoints + 1)));
  const batches = await Promise.all(midpoints.map((p) => placesNearby(p.lat, p.lng, radiusM)));

  console.log('EV results per midpoint:', batches.map((b) => b.length));

  // Build unique station list — apply corridor + rating filters
  const CORRIDOR_KM = 5;
  const MIN_RATING = 3.0;
  const seen = new Set();
  const stations = [];

  for (const batch of batches) {
    for (const place of batch) {
      const placeId = place.id || place.place_id;
      if (seen.has(placeId)) continue;
      seen.add(placeId);

      const loc = place.location
        ? { lat: place.location.latitude, lng: place.location.longitude }
        : place.geometry?.location;
      if (!loc) continue;

      // Corridor filter: prefer real road route; fall back to straight line
      const corridorDist = routeWaypoints
        ? distToRouteKm(loc, routeWaypoints)
        : distToSegmentKm(loc, originCoord, destCoord);
      if (corridorDist > CORRIDOR_KM) continue;

      // Rating filter: skip low-rated (allow unrated stations)
      const rating = place.rating || 0;
      if (rating > 0 && rating < MIN_RATING) continue;

      stations.push({
        placeId,
        name: place.displayName?.text || place.name || '',
        address: place.shortFormattedAddress || '',
        distKm: Math.round(haversineKm(originCoord, loc)),
        lat: loc.lat,
        lng: loc.lng,
        rating,
      });
    }
  }

  console.log('EV stations after filters:', stations.length);

  // Sort by distance from origin (A→B order) before any selection
  stations.sort((a, b) => a.distKm - b.distKm);

  const batteryOk = reachableKm >= routeKm;

  if (!stations.length) {
    if (batteryOk) return { stations: [], originCoord, destCoord, canReachDest: true };
    return { error: 'ไม่พบจุดชาร์จ EV บนเส้นทางนี้' };
  }

  const { stops, canReachDest } = planChargingStops(
    stations, originCoord, destCoord, reachableKm, maxRangeKm,
  );

  if (!stops.length) {
    // Battery sufficient — return corridor stations as suggestions
    return { stations: stations.slice(0, 5), originCoord, destCoord, canReachDest: true };
  }

  return { stations: stops, originCoord, destCoord, canReachDest };
}

module.exports = { searchEvStations };
