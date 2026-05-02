export function getLocationLabel(locationValue) {
  if (!locationValue) return '';
  if (typeof locationValue === 'string') return locationValue;

  const city = String(locationValue.city || '').trim();
  const area = String(locationValue.area || '').trim();
  const legacy = String(locationValue.label || locationValue.text || '').trim();

  if (area && city) return `${area}, ${city}`;
  if (city) return city;
  if (area) return area;
  return legacy;
}

export function getLocationCity(locationValue) {
  if (!locationValue || typeof locationValue === 'string') {
    return '';
  }
  return String(locationValue.city || '').trim();
}

export function getLocationCoords(locationValue) {
  if (!locationValue || typeof locationValue === 'string') {
    return null;
  }

  // Try nested coordinates object first
  let latitude = Number(locationValue.coordinates?.latitude);
  let longitude = Number(locationValue.coordinates?.longitude);

  // Fall back to top-level latitude/longitude fields
  if (!Number.isFinite(latitude)) {
    latitude = Number(locationValue.latitude);
  }
  if (!Number.isFinite(longitude)) {
    longitude = Number(locationValue.longitude);
  }

  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
    return null;
  }

  return { latitude, longitude };
}

export function distanceKm(fromCoords, toCoords) {
  if (!fromCoords || !toCoords) return null;

  const lat1 = Number(fromCoords.latitude);
  const lon1 = Number(fromCoords.longitude);
  const lat2 = Number(toCoords.latitude);
  const lon2 = Number(toCoords.longitude);

  if (![lat1, lon1, lat2, lon2].every(Number.isFinite)) return null;

  const toRad = (deg) => (deg * Math.PI) / 180;
  const earthKm = 6371;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) *
    Math.sin(dLon / 2) * Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return earthKm * c;
}
