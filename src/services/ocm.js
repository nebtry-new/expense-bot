const OCM_API_KEY = process.env.OCM_API_KEY || '';

// Geocode a place name to lat/lng using Nominatim (OpenStreetMap) — free, no key needed
async function geocode(placeName) {
  const url = `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(placeName + ' Thailand')}&format=json&limit=1`;
  const res = await fetch(url, { headers: { 'User-Agent': 'expense-bot/1.0' } });
  const data = await res.json();
  if (!data?.length) return null;
  return { lat: parseFloat(data[0].lat), lng: parseFloat(data[0].lon), displayName: data[0].display_name };
}

// Distance between two lat/lng points in km (Haversine)
function distanceKm(lat1, lng1, lat2, lng2) {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLng = ((lng2 - lng1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

// Perpendicular distance from point P to line segment A→B in km
function distanceToSegmentKm(aLat, aLng, bLat, bLng, pLat, pLng) {
  const totalDist = distanceKm(aLat, aLng, bLat, bLng);
  if (totalDist < 0.1) return distanceKm(aLat, aLng, pLat, pLng);
  const t = Math.max(
    0,
    Math.min(
      1,
      ((pLat - aLat) * (bLat - aLat) + (pLng - aLng) * (bLng - aLng)) /
        ((bLat - aLat) ** 2 + (bLng - aLng) ** 2)
    )
  );
  const projLat = aLat + t * (bLat - aLat);
  const projLng = aLng + t * (bLng - aLng);
  return distanceKm(projLat, projLng, pLat, pLng);
}

// Fetch charging stations from Open Charge Map within bounding box of the route
async function getStationsAlongRoute(originCoords, destCoords, corridorKm = 30) {
  const minLat = Math.min(originCoords.lat, destCoords.lat) - 0.5;
  const maxLat = Math.max(originCoords.lat, destCoords.lat) + 0.5;
  const minLng = Math.min(originCoords.lng, destCoords.lng) - 0.5;
  const maxLng = Math.max(originCoords.lng, destCoords.lng) + 0.5;

  const params = new URLSearchParams({
    output: 'json',
    boundingbox: `(${minLat},${minLng}),(${maxLat},${maxLng})`,
    maxresults: '100',
    compact: 'true',
    verbose: 'false',
    ...(OCM_API_KEY ? { key: OCM_API_KEY } : {}),
  });

  const res = await fetch(`https://api.openchargemap.io/v3/poi/?${params}`);
  const stations = await res.json();

  if (!Array.isArray(stations)) return [];

  return stations
    .map((s) => {
      const lat = s.AddressInfo?.Latitude;
      const lng = s.AddressInfo?.Longitude;
      if (!lat || !lng) return null;

      const numPoints = s.NumberOfPoints || 1;
      const distFromRoute = distanceToSegmentKm(
        originCoords.lat, originCoords.lng,
        destCoords.lat, destCoords.lng,
        lat, lng
      );
      const distFromOrigin = distanceKm(originCoords.lat, originCoords.lng, lat, lng);

      return {
        name: s.AddressInfo?.Title || 'ไม่ระบุชื่อ',
        address: s.AddressInfo?.AddressLine1 || s.AddressInfo?.Town || '',
        lat,
        lng,
        numPoints,
        operator: s.OperatorInfo?.Title || null,
        distFromRoute,
        distFromOrigin,
        mapsUrl: `https://www.google.com/maps/search/?api=1&query=${lat},${lng}`,
      };
    })
    .filter((s) => s && s.distFromRoute <= corridorKm)
    .sort((a, b) => b.numPoints - a.numPoints || a.distFromOrigin - b.distFromOrigin);
}

// Find optimal charging stops given battery % and car range
// Returns stations the car can safely reach while keeping ≥ minReserve% battery
function planChargingStops(stations, originCoords, batteryPct, maxRangeKm, minReservePct = 20) {
  const safeRangeKm = ((batteryPct - minReservePct) / 100) * maxRangeKm;
  return stations.filter((s) => s.distFromOrigin <= safeRangeKm).slice(0, 3);
}

module.exports = { geocode, getStationsAlongRoute, planChargingStops, distanceKm };
