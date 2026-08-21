/**
 * Small parsers shared by Airtable import and Plot API mapping.
 */

export function parseMapCoordinates (value) {
  if (typeof value !== 'string') return { latitude: null, longitude: null };
  const match = value.match(/^\s*(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)\s*$/);
  if (!match) return { latitude: null, longitude: null };
  const latitude = Number(match[1]);
  const longitude = Number(match[2]);
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
    return { latitude: null, longitude: null };
  }
  return { latitude, longitude };
}

export function parseAirtableDate (value) {
  if (value == null || value === '') return null;
  if (value instanceof Date) return value;
  if (typeof value !== 'string') return null;
  // ISO date or datetime
  if (/^\d{4}-\d{2}-\d{2}/.test(value)) {
    const d = new Date(value);
    return Number.isNaN(d.getTime()) ? null : d;
  }
  // M/D/YYYY or MM/DD/YYYY
  const mdy = value.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (mdy) {
    const d = new Date(Date.UTC(Number(mdy[3]), Number(mdy[1]) - 1, Number(mdy[2])));
    return Number.isNaN(d.getTime()) ? null : d;
  }
  return null;
}
