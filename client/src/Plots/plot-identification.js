export function suggestedTitle (address, locator) {
  const detail = locator.trim().replace(/[.!]+$/, '');
  if (!detail) return '';
  const shortAddress = address.trim().replace(/,?\s*San Francisco\b.*$/i, '');
  return [shortAddress, detail].filter(Boolean).join(' · ');
}

export function addressSuggestionPatch (values, result) {
  if (values.addressEdited || !result || !values.position ||
    values.position.latitude.toFixed(5) !== result.position.latitude.toFixed(5) ||
    values.position.longitude.toFixed(5) !== result.position.longitude.toFixed(5)) return {};
  return { address: result.address };
}

export async function lookupAddress (position, { baseUrl, signal, fetchAddress = fetch, distanceTo } = {}) {
  const params = new URLSearchParams({ lat: String(position.latitude), lon: String(position.longitude), limit: '5', lang: 'en', radius: '0.1' });
  const response = await fetchAddress(`${(baseUrl || 'https://photon.komoot.io').replace(/\/$/, '')}/reverse?${params}`, {
    signal: AbortSignal.any([...(signal ? [signal] : []), AbortSignal.timeout(8000)]), credentials: 'omit', referrerPolicy: 'no-referrer',
  });
  if (!response.ok) throw new Error('Address lookup is unavailable');
  const { features = [] } = await response.json();
  if (!distanceTo) {
    const { latLng } = await import('leaflet');
    const point = latLng(position.latitude, position.longitude);
    distanceTo = (coordinates) => point.distanceTo([coordinates[1], coordinates[0]]);
  }
  const nearby = features.filter(({ properties, geometry }) => properties?.housenumber && properties?.street &&
    Array.isArray(geometry?.coordinates) && geometry.coordinates.length >= 2 && geometry.coordinates.every(Number.isFinite))
    .map((feature) => ({ ...feature, distance: distanceTo(feature.geometry.coordinates) }))
    .filter(({ distance }) => distance <= 80).sort((a, b) => a.distance - b.distance);
  if (!nearby.length) throw new Error('No nearby numbered address was found');
  const p = nearby[0].properties;
  return { position, address: [`${p.housenumber} ${p.street}`, p.city, p.state, p.postcode].filter(Boolean).join(', ') };
}
