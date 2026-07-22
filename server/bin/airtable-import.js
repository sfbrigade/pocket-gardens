#!/usr/bin/env node

/**
 * Idempotent two-pass Airtable → Postgres import.
 *
 * Pass 1: upsert scalar records keyed by airtableId
 * Pass 2: wire foreign keys and join tables using airtableId → UUID map
 *
 * Usage:
 *   bin/airtable-import.js [--dry-run] [--tables=Plots,Plants,...]
 *
 * Env: AIRTABLE_API_KEY, AIRTABLE_BASE_ID
 *      DATABASE_URL (required unless --dry-run)
 */

import crypto from 'node:crypto';

import '../config.js';
import {
  parseAirtableDate,
  parseMapCoordinates,
} from '#lib/airtable-schema.js';

const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
const tablesArg = args.find((a) => a.startsWith('--tables='));
const onlyTables = tablesArg
  ? tablesArg.slice('--tables='.length).split(',').map((s) => s.trim()).filter(Boolean)
  : null;

const report = {
  dryRun,
  startedAt: new Date().toISOString(),
  tables: {},
  skippedFields: [],
  unresolvedLinks: [],
  typeConversionFailures: [],
  errors: [],
};

let prisma;

function requireEnv () {
  const required = ['AIRTABLE_API_KEY', 'AIRTABLE_BASE_ID'];
  if (!dryRun) required.push('DATABASE_URL');
  for (const key of required) {
    if (!process.env[key]) throw new Error(`${key} must be set`);
  }
  return {
    apiKey: process.env.AIRTABLE_API_KEY,
    baseId: process.env.AIRTABLE_BASE_ID,
  };
}

async function listAllRecords (apiKey, baseId, tableName) {
  const records = [];
  let offset;
  do {
    const url = new URL(`https://api.airtable.com/v0/${baseId}/${encodeURIComponent(tableName)}`);
    url.searchParams.set('pageSize', '100');
    if (offset) url.searchParams.set('offset', offset);
    const response = await fetch(url, {
      headers: { Authorization: `Bearer ${apiKey}` },
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      const err = new Error(data.error?.message || response.statusText);
      err.status = response.status;
      throw err;
    }
    records.push(...(data.records || []));
    offset = data.offset;
  } while (offset);
  return records;
}

function firstLink (value) {
  if (!Array.isArray(value) || !value.length) return null;
  return typeof value[0] === 'string' ? value[0] : null;
}

function linkIds (value) {
  if (!Array.isArray(value)) return [];
  return value.filter((v) => typeof v === 'string' && v.startsWith('rec'));
}

function asStringArray (value) {
  if (!Array.isArray(value)) return [];
  return value.filter((v) => typeof v === 'string');
}

function stringifyMaybe (value) {
  if (value == null) return null;
  if (typeof value === 'string') return value;
  if (typeof value === 'object' && value.error) return null;
  return String(value);
}

function tableEnabled (name) {
  return !onlyTables || onlyTables.includes(name);
}

async function upsertMany (label, items, upsertFn, idMap) {
  const stats = { fetched: items.length, upserted: 0, failed: 0 };
  report.tables[label] = stats;
  for (const item of items) {
    try {
      if (dryRun) {
        // Provisional UUIDs let the relation pass report unresolved links without DB writes.
        if (idMap) idMap.set(item.id, crypto.randomUUID());
      } else {
        await upsertFn(item);
      }
      stats.upserted += 1;
    } catch (err) {
      stats.failed += 1;
      report.errors.push({ table: label, airtableId: item.id, message: err.message });
    }
  }
  return stats;
}

async function main () {
  const { apiKey, baseId } = requireEnv();
  if (!dryRun) {
    ({ default: prisma } = await import('#prisma/client.js'));
  }
  const idMaps = {
    neighborhood: new Map(),
    zipCode: new Map(),
    person: new Map(),
    plant: new Map(),
    partner: new Map(),
    plot: new Map(),
    maintenanceRecord: new Map(),
  };

  // ---------- Fetch ----------
  const fetched = {};
  for (const [key, tableName] of [
    ['neighborhoods', 'Neighborhoods'],
    ['zipCodes', 'Zip Codes'],
    ['people', 'People'],
    ['plants', 'Plants'],
    ['partners', 'Suppliers|Partners'],
    ['plots', 'Plots'],
    ['maintenance', 'Maintenance Records'],
  ]) {
    if (!tableEnabled(tableName)) {
      fetched[key] = [];
      continue;
    }
    try {
      fetched[key] = await listAllRecords(apiKey, baseId, tableName);
      console.error(`Fetched ${fetched[key].length} from ${tableName}`);
    } catch (err) {
      report.errors.push({ table: tableName, message: err.message, status: err.status });
      console.error(`Failed to fetch ${tableName}: ${err.message}`);
      fetched[key] = [];
    }
  }

  // ---------- Pass 1: scalars ----------
  await upsertMany('Neighborhood', fetched.neighborhoods, async (rec) => {
    const data = {
      airtableId: rec.id,
      name: stringifyMaybe(rec.fields.Neighborhoods) || rec.id,
      createdAt: new Date(rec.createdTime),
    };
    const row = await prisma.neighborhood.upsert({
      where: { airtableId: rec.id },
      create: data,
      update: { name: data.name },
    });
    idMaps.neighborhood.set(rec.id, row.id);
  }, idMaps.neighborhood);

  await upsertMany('ZipCode', fetched.zipCodes, async (rec) => {
    const data = {
      airtableId: rec.id,
      code: stringifyMaybe(rec.fields['Zip Codes']),
      plantedPlotCount: typeof rec.fields['# Planted Plots'] === 'number' ? rec.fields['# Planted Plots'] : null,
      notYetPlantedPlotCount: typeof rec.fields['# Not-Yet-Planted Plots'] === 'number'
        ? rec.fields['# Not-Yet-Planted Plots']
        : null,
      createdAt: new Date(rec.createdTime),
    };
    const row = await prisma.zipCode.upsert({
      where: { airtableId: rec.id },
      create: data,
      update: {
        code: data.code,
        plantedPlotCount: data.plantedPlotCount,
        notYetPlantedPlotCount: data.notYetPlantedPlotCount,
      },
    });
    idMaps.zipCode.set(rec.id, row.id);
  }, idMaps.zipCode);

  await upsertMany('Person', fetched.people, async (rec) => {
    const data = {
      airtableId: rec.id,
      firstName: stringifyMaybe(rec.fields['First Name']),
      lastName: stringifyMaybe(rec.fields['Last Name']),
      name: stringifyMaybe(rec.fields.Name),
      email: stringifyMaybe(rec.fields.Email),
      phone: stringifyMaybe(rec.fields.Phone),
      createdAt: new Date(rec.createdTime),
    };
    const row = await prisma.person.upsert({
      where: { airtableId: rec.id },
      create: data,
      update: {
        firstName: data.firstName,
        lastName: data.lastName,
        name: data.name,
        email: data.email,
        phone: data.phone,
      },
    });
    idMaps.person.set(rec.id, row.id);
  }, idMaps.person);

  await upsertMany('Plant', fetched.plants, async (rec) => {
    const data = {
      airtableId: rec.id,
      plantName: stringifyMaybe(rec.fields['Plant Name']),
      latinName: stringifyMaybe(rec.fields['Latin Name']),
      commonName: stringifyMaybe(rec.fields['Common Name']),
      locations: stringifyMaybe(rec.fields.Locations),
      numberPlanted: typeof rec.fields['Number Planted'] === 'number' ? rec.fields['Number Planted'] : null,
      photo: rec.fields.Photo ?? null,
      createdAt: new Date(rec.createdTime),
    };
    const row = await prisma.plant.upsert({
      where: { airtableId: rec.id },
      create: data,
      update: {
        plantName: data.plantName,
        latinName: data.latinName,
        commonName: data.commonName,
        locations: data.locations,
        numberPlanted: data.numberPlanted,
        photo: data.photo,
      },
    });
    idMaps.plant.set(rec.id, row.id);
  }, idMaps.plant);

  await upsertMany('Partner', fetched.partners, async (rec) => {
    const f = rec.fields;
    const data = {
      airtableId: rec.id,
      orgName: stringifyMaybe(f['Org Name']),
      contactName: stringifyMaybe(f['Contact Name']),
      title: stringifyMaybe(f.Title),
      email: stringifyMaybe(f.Email),
      phone: stringifyMaybe(f.Phone),
      notes: stringifyMaybe(f.Notes),
      createdAt: new Date(rec.createdTime),
    };
    const row = await prisma.partner.upsert({
      where: { airtableId: rec.id },
      create: data,
      update: {
        orgName: data.orgName,
        contactName: data.contactName,
        title: data.title,
        email: data.email,
        phone: data.phone,
        notes: data.notes,
      },
    });
    idMaps.partner.set(rec.id, row.id);
  }, idMaps.partner);

  await upsertMany('Plot', fetched.plots, async (rec) => {
    const f = rec.fields;
    const { latitude, longitude } = parseMapCoordinates(f['Map Coordinates']);
    const data = {
      airtableId: rec.id,
      name: stringifyMaybe(f['Pocket Garden Name']),
      status: stringifyMaybe(f.Status),
      streetAddress: stringifyMaybe(f['Street Address']),
      streetCityAddress: stringifyMaybe(f['Street City Address (for Maps)']),
      mapCoordinates: stringifyMaybe(f['Map Coordinates']),
      latitude,
      longitude,
      bedType: stringifyMaybe(f['Bed Type']),
      bedId: stringifyMaybe(f['Bed ID']),
      soilType: stringifyMaybe(f['Soil Type']),
      visitIntervalDays: typeof f['Visit Interval (Days)'] === 'number' ? f['Visit Interval (Days)'] : null,
      estAreaSqFt: typeof f['Est. Area (Sq. Ft)'] === 'number' ? f['Est. Area (Sq. Ft)'] : null,
      locationDescription: stringifyMaybe(f['Location Description']),
      sethsNotes: stringifyMaybe(f["Seth's Notes"]),
      geocodeCache: stringifyMaybe(f['Geocode Cache (for Maps)']),
      photo: f.Photo ?? null,
      photos: f.Photos ?? null,
      originalPlantDate: parseAirtableDate(f['Original Plant Date']),
      lastPlant: parseAirtableDate(f['Last Plant']),
      lastWater: parseAirtableDate(f['Last Water']),
      lastWeed: parseAirtableDate(f['Last Weed']),
      lastMulch: parseAirtableDate(f['Last Mulch']),
      lastVisit: parseAirtableDate(f['Last Visit']),
      nextVisit: stringifyMaybe(f['Next Visit']),
      alert: stringifyMaybe(f.Alert),
      createdAt: new Date(rec.createdTime),
    };
    const row = await prisma.plot.upsert({
      where: { airtableId: rec.id },
      create: data,
      update: { ...data, createdAt: undefined },
    });
    idMaps.plot.set(rec.id, row.id);
  }, idMaps.plot);

  await upsertMany('MaintenanceRecord', fetched.maintenance, async (rec) => {
    const f = rec.fields;
    const data = {
      airtableId: rec.id,
      airtableNumber: typeof f.ID === 'number' ? f.ID : null,
      date: parseAirtableDate(f.Date),
      activity: asStringArray(f.Activity),
      notes: stringifyMaybe(f.Notes),
      planting: stringifyMaybe(f.Planting),
      estNextVisit: parseAirtableDate(f['Est. Next Visit']),
      volunteerPhotos: f['Volunteer Photos'] ?? null,
      createdAt: new Date(rec.createdTime),
    };
    const row = await prisma.maintenanceRecord.upsert({
      where: { airtableId: rec.id },
      create: data,
      update: { ...data, createdAt: undefined },
    });
    idMaps.maintenanceRecord.set(rec.id, row.id);
  }, idMaps.maintenanceRecord);

  function resolve (map, airtableId, context) {
    if (!airtableId) return null;
    const id = map.get(airtableId);
    if (!id) {
      report.unresolvedLinks.push(context);
      return null;
    }
    return id;
  }

  // ---------- Pass 2: relations (resolve always; write unless dry-run) ----------
  for (const rec of fetched.neighborhoods) {
    const neighborhoodId = idMaps.neighborhood.get(rec.id);
    if (!neighborhoodId) continue;
    for (const zipAirtableId of linkIds(rec.fields['Zip Codes'])) {
      const zipCodeId = resolve(idMaps.zipCode, zipAirtableId, {
        from: 'Neighborhoods', fromId: rec.id, field: 'Zip Codes', toId: zipAirtableId,
      });
      if (!zipCodeId || dryRun) continue;
      await prisma.neighborhoodZipCode.upsert({
        where: { neighborhoodId_zipCodeId: { neighborhoodId, zipCodeId } },
        create: { neighborhoodId, zipCodeId },
        update: {},
      });
    }
  }

  for (const rec of fetched.people) {
    const personId = idMaps.person.get(rec.id);
    if (!personId) continue;
    const homeZipId = resolve(idMaps.zipCode, firstLink(rec.fields.Zip), {
      from: 'People', fromId: rec.id, field: 'Zip', toId: firstLink(rec.fields.Zip),
    });
    if (dryRun) continue;
    await prisma.person.update({
      where: { id: personId },
      data: { homeZipId },
    });
  }

  for (const rec of fetched.zipCodes) {
    const zipCodeId = idMaps.zipCode.get(rec.id);
    if (!zipCodeId) continue;
    for (const personAirtableId of linkIds(rec.fields['Local Volunteers'])) {
      const personId = resolve(idMaps.person, personAirtableId, {
        from: 'Zip Codes', fromId: rec.id, field: 'Local Volunteers', toId: personAirtableId,
      });
      if (!personId || dryRun) continue;
      await prisma.personZipCode.upsert({
        where: { personId_zipCodeId: { personId, zipCodeId } },
        create: { personId, zipCodeId },
        update: {},
      });
    }
  }

  for (const rec of fetched.plots) {
    const plotId = idMaps.plot.get(rec.id);
    if (!plotId) continue;
    const zipCodeId = resolve(idMaps.zipCode, firstLink(rec.fields['Zip Code']), {
      from: 'Plots', fromId: rec.id, field: 'Zip Code', toId: firstLink(rec.fields['Zip Code']),
    });
    const neighborhoodId = resolve(idMaps.neighborhood, firstLink(rec.fields.Neighborhood), {
      from: 'Plots', fromId: rec.id, field: 'Neighborhood', toId: firstLink(rec.fields.Neighborhood),
    });
    const lastVolunteerId = resolve(idMaps.person, firstLink(rec.fields['Last Volunteer']), {
      from: 'Plots', fromId: rec.id, field: 'Last Volunteer', toId: firstLink(rec.fields['Last Volunteer']),
    });
    if (!dryRun) {
      await prisma.plot.update({
        where: { id: plotId },
        data: { zipCodeId, neighborhoodId, lastVolunteerId },
      });
    }
    for (const personAirtableId of linkIds(rec.fields['Assigned Volunteer/s'])) {
      const personId = resolve(idMaps.person, personAirtableId, {
        from: 'Plots', fromId: rec.id, field: 'Assigned Volunteer/s', toId: personAirtableId,
      });
      if (!personId || dryRun) continue;
      await prisma.plotAssignedVolunteer.upsert({
        where: { plotId_personId: { plotId, personId } },
        create: { plotId, personId },
        update: {},
      });
    }
  }

  for (const rec of fetched.maintenance) {
    const maintenanceRecordId = idMaps.maintenanceRecord.get(rec.id);
    if (!maintenanceRecordId) continue;
    const plotId = resolve(idMaps.plot, firstLink(rec.fields.Plot), {
      from: 'Maintenance Records', fromId: rec.id, field: 'Plot', toId: firstLink(rec.fields.Plot),
    });
    const volunteerId = resolve(idMaps.person, firstLink(rec.fields.Volunteer), {
      from: 'Maintenance Records', fromId: rec.id, field: 'Volunteer', toId: firstLink(rec.fields.Volunteer),
    });
    if (!dryRun) {
      await prisma.maintenanceRecord.update({
        where: { id: maintenanceRecordId },
        data: { plotId, volunteerId },
      });
    }

    for (let slot = 1; slot <= 8; slot += 1) {
      const plantAirtableId = firstLink(rec.fields[`Plant ${slot}`]);
      if (!plantAirtableId) continue;
      const plantId = resolve(idMaps.plant, plantAirtableId, {
        from: 'Maintenance Records', fromId: rec.id, field: `Plant ${slot}`, toId: plantAirtableId,
      });
      if (!plantId || dryRun) continue;
      const quantity = typeof rec.fields[`# Plant ${slot}`] === 'number'
        ? rec.fields[`# Plant ${slot}`]
        : null;
      await prisma.maintenanceRecordPlant.upsert({
        where: {
          maintenanceRecordId_slot: { maintenanceRecordId, slot },
        },
        create: { maintenanceRecordId, plantId, slot, quantity },
        update: { plantId, quantity },
      });
    }
  }

  report.finishedAt = new Date().toISOString();
  report.counts = {
    neighborhoods: idMaps.neighborhood.size,
    zipCodes: idMaps.zipCode.size,
    people: idMaps.person.size,
    plants: idMaps.plant.size,
    partners: idMaps.partner.size,
    plots: idMaps.plot.size,
    maintenanceRecords: idMaps.maintenanceRecord.size,
    unresolvedLinks: report.unresolvedLinks.length,
    errors: report.errors.length,
  };

  console.log(JSON.stringify(report, null, 2));
  if (prisma) await prisma.$disconnect();
  if (report.errors.length) process.exitCode = 1;
}

main().catch(async (err) => {
  console.error(err);
  if (prisma) await prisma.$disconnect().catch(() => {});
  process.exit(1);
});
