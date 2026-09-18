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
  const loc = data.results?.[0]?.geometry?.location;
  return loc ? { lat: loc.lat, lng: loc.lng } : null;
}

async function placesNearby(lat, lng, radiusM) {
  const url = `https://maps.googleapis.com/maps/api/place/nearbysearch/json`
    + `?location=${lat},${lng}&radius=${radiusM}&type=electric_vehicle_charging_station&key=${apiKey}`;
  const res = await fetch(url);
  const data = await res.json();
  return data.results || [];
}

async function searchEvStations(originText, destText, batteryPct, maxRangeKm) {
  if (!apiKey) return 'ไม่ได้ตั้งค่า GOOGLE_PLACES_API_KEY';

  const [originCoord, destCoord] = await Promise.all([
    geocodeText(originText),
    geocodeText(destText),
  ]);
  if (!originCoord) return `หาตำแหน่งต้นทางไม่ได้ กรุณาลองใหม่`;
  if (!destCoord) return `หาตำแหน่งปลายทางไม่ได้ กรุณาลองใหม่`;

  const reachableKm = (batteryPct / 100) * maxRangeKm;
  const routeKm = haversineKm(originCoord, destCoord);
  const radiusM = Math.min(50000, Math.round(routeKm * 1000 * 0.25));

  // Search at 25%, 50%, 75% along the straight-line route
  const midpoints = [0.25, 0.5, 0.75].map((t) => interpolate(originCoord, destCoord, t));
  const batches = await Promise.all(midpoints.map((p) => placesNearby(p.lat, p.lng, radiusM)));

  // Deduplicate by place_id, compute straight-line distance from origin
  const seen = new Set();
  const stations = [];
  for (const batch of batches) {
    for (const place of batch) {
      if (seen.has(place.place_id)) continue;
      seen.add(place.place_id);
      const loc = place.geometry.location;
      const distKm = Math.round(haversineKm(originCoord, loc));
      if (distKm <= reachableKm) {
        stations.push({
          name: (place.name || '').slice(0, 30),
          distKm,
          lat: loc.lat,
          lng: loc.lng,
          rating: place.rating || 0,
        });
      }
    }
  }

  if (!stations.length) return 'ไม่พบจุดชาร์จ EV บนเส้นทางนี้';

  // Prefer stations where battery has dropped >50% of remaining range
  const halfKm = reachableKm * 0.5;
  const preferred = stations.filter((s) => s.distKm >= halfKm);
  const early = stations.filter((s) => s.distKm < halfKm);

  const byRating = (a, b) => b.rating - a.rating || a.distKm - b.distKm;
  const top5 = [...preferred.sort(byRating), ...early.sort(byRating)].slice(0, 5);

  const lines = top5.map((s, i) => {
    const link = `https://maps.google.com/maps?q=${s.lat},${s.lng}`;
    return `${i + 1}. ${s.name} ~${s.distKm}กม.\n${link}`;
  });

  return `จุดชาร์จแนะนำ:\n\n${lines.join('\n\n')}`;
}

module.exports = { searchEvStations };
