const apiKey = process.env.GOOGLE_PLACES_API_KEY;

function haversineKm(a, b) {
  const R = 6371;
  const dLat = (b.lat - a.lat) * (Math.PI / 180);
  const dLng = (b.lng - a.lng) * (Math.PI / 180);
  const h = Math.sin(dLat / 2) ** 2
    + Math.cos(a.lat * (Math.PI / 180)) * Math.cos(b.lat * (Math.PI / 180)) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.asin(Math.sqrt(h));
}

function interpolate(a, b, t) {
  return { lat: a.lat + (b.lat - a.lat) * t, lng: a.lng + (b.lng - a.lng) * t };
}

async function geocodeText(text) {
  // Extract embedded coords: "name (lat,lng)" or "lat,lng"
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
  // New Places API (v1) — better Thailand EV station coverage than old nearbysearch
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
      maxResultCount: 20,
    }),
  });
  const data = await res.json();
  if (data.error) {
    console.error('Places API v1 error:', data.error);
    return [];
  }
  return data.places || [];
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
  const routeKm = haversineKm(originCoord, destCoord);
  // Minimum 15km radius so short routes still get results
  const radiusM = Math.min(50000, Math.max(15000, Math.round(routeKm * 1000 * 0.25)));

  console.log('EV search:', { originCoord, destCoord, routeKm: routeKm.toFixed(1), radiusM, reachableKm: reachableKm.toFixed(1) });

  // Search at 25%, 50%, 75% along the straight-line route
  const midpoints = [0.25, 0.5, 0.75].map((t) => interpolate(originCoord, destCoord, t));
  const batches = await Promise.all(midpoints.map((p) => placesNearby(p.lat, p.lng, radiusM)));

  console.log('EV search results per midpoint:', batches.map((b) => b.length));

  // Deduplicate by id, compute straight-line distance from origin
  const seen = new Set();
  const stations = [];
  for (const batch of batches) {
    for (const place of batch) {
      const id = place.id || place.place_id;
      if (seen.has(id)) continue;
      seen.add(id);
      // New API: place.location = { latitude, longitude }; Old API: place.geometry.location = { lat, lng }
      const loc = place.location
        ? { lat: place.location.latitude, lng: place.location.longitude }
        : place.geometry?.location;
      if (!loc) continue;
      const distKm = Math.round(haversineKm(originCoord, loc));
      const name = place.displayName?.text || place.name || '';
      const address = place.shortFormattedAddress || '';
      stations.push({
        name,
        address,
        distKm,
        lat: loc.lat,
        lng: loc.lng,
        rating: place.rating || 0,
      });
    }
  }

  console.log('EV stations before range filter:', stations.length, '| reachableKm:', reachableKm.toFixed(1));

  const inRange = stations.filter((s) => s.distKm <= reachableKm);

  if (!inRange.length) {
    return stations.length
      ? { error: `พบ ${stations.length} สถานี แต่อยู่เกินระยะแบต (~${Math.round(reachableKm)} กม.) กรุณาชาร์จก่อนออกเดินทาง` }
      : { error: 'ไม่พบจุดชาร์จ EV บนเส้นทางนี้' };
  }

  // Select: prefer stations where battery has dropped >50% (worth stopping)
  const halfKm = reachableKm * 0.5;
  const preferred = inRange.filter((s) => s.distKm >= halfKm);
  const early = inRange.filter((s) => s.distKm < halfKm);

  const byRating = (a, b) => b.rating - a.rating || a.distKm - b.distKm;
  const top5 = [...preferred.sort(byRating), ...early.sort(byRating)].slice(0, 5);

  // Display order: ascending distance (A→B route order)
  top5.sort((a, b) => a.distKm - b.distKm);

  return { stations: top5 };
}

module.exports = { searchEvStations };
