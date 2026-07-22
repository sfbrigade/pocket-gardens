import { test } from 'node:test';
import * as assert from 'node:assert';

import {
  parseAirtableDate,
  parseMapCoordinates,
} from '#lib/airtable-schema.js';
import {
  buildViewportWhere,
  decodeListOffset,
  encodeListOffset,
  formatPlot,
  plotFieldsFromBody,
} from '#models/plot.js';

test('parseMapCoordinates extracts lat/lng', () => {
  assert.deepStrictEqual(parseMapCoordinates('37.77872, -122.46517'), {
    latitude: 37.77872,
    longitude: -122.46517,
  });
  assert.deepStrictEqual(parseMapCoordinates('not a coord'), {
    latitude: null,
    longitude: null,
  });
});

test('parseAirtableDate handles ISO and US formats', () => {
  assert.strictEqual(parseAirtableDate('2025-03-21')?.toISOString().startsWith('2025-03-21'), true);
  assert.strictEqual(parseAirtableDate('3/07/2025')?.toISOString().startsWith('2025-03-07'), true);
  assert.strictEqual(parseAirtableDate(null), null);
});

test('formatPlot exposes Airtable id and Latitude/Longitude', () => {
  const formatted = formatPlot({
    id: '11111111-1111-4111-8111-111111111111',
    airtableId: 'recPlotAlpha',
    createdAt: new Date('2023-01-01T12:00:00.000Z'),
    latitude: 37.78,
    longitude: -122.42,
    status: 'Planted',
    bedType: 'Tree Well',
    name: 'Alpha',
  });
  assert.strictEqual(formatted.id, 'recPlotAlpha');
  assert.strictEqual(formatted.Latitude, 37.78);
  assert.strictEqual(formatted.Longitude, -122.42);
  assert.strictEqual(formatted.Status, 'Planted');
  assert.strictEqual(formatted['Bed Type'], 'Tree Well');
});

test('plotFieldsFromBody derives coordinates from Map Coordinates', () => {
  const data = plotFieldsFromBody({
    Status: 'Planted',
    'Map Coordinates': '37.5, -122.5',
  });
  assert.strictEqual(data.status, 'Planted');
  assert.strictEqual(data.latitude, 37.5);
  assert.strictEqual(data.longitude, -122.5);
});

test('viewport where and offset encoding round-trip', () => {
  assert.deepStrictEqual(
    buildViewportWhere({ north: 37.82, south: 37.75, east: -122.38, west: -122.45 }),
    {
      latitude: { gte: 37.75, lte: 37.82 },
      longitude: { gte: -122.45, lte: -122.38 },
    }
  );
  assert.strictEqual(encodeListOffset(25), '25');
  assert.strictEqual(decodeListOffset('25'), 25);
  assert.strictEqual(decodeListOffset('50'), 50);
  assert.strictEqual(decodeListOffset('not-a-number'), 0);
});
