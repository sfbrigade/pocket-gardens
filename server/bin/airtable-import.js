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
 *      AWS_S3_* (required unless --dry-run when importing Plots; used for Photo/Photos)
 */

import crypto from 'node:crypto';

import '../config.js';
import {
  isMigratedAssetPaths,
  uploadAirtableAttachments,
} from '#lib/airtable-photos.js';
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
  plotPhotos: { uploaded: 0, skipped: 0, cleared: 0, errors: [] },
  fetchStatus: {},
  unresolvedLinks: [],
  errors: [],
};

let prisma;

function requireEnv () {
  const required = ['AIRTABLE_API_KEY', 'AIRTABLE_BASE_ID'];
  if (!dryRun) {
    required.push('DATABASE_URL');
    if (!onlyTables || onlyTables.includes('Plots')) {
      required.push(
        'AWS_S3_ACCESS_KEY_ID',
        'AWS_S3_SECRET_ACCESS_KEY',
        'AWS_S3_BUCKET',
        'AWS_S3_REGION',
      );
    }
  }
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
  // Status: 'ok' | 'skipped' | 'failed'. Relation writes only use maps that are 'ok'.
  const fetchStatus = report.fetchStatus;
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
      fetchStatus[key] = 'skipped';
      continue;
    }
    try {
      fetched[key] = await listAllRecords(apiKey, baseId, tableName);
      fetchStatus[key] = 'ok';
      console.error(`Fetched ${fetched[key].length} from ${tableName}`);
    } catch (err) {
      report.errors.push({ table: tableName, message: err.message, status: err.status });
      console.error(`Failed to fetch ${tableName}: ${err.message}`);
      fetched[key] = [];
      fetchStatus[key] = 'failed';
    }
  }

  function mapReady (key) {
    return fetchStatus[key] === 'ok';
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

    const photoUpdate = {};
    for (const [attribute, attachments, existing] of [
      ['photo', f.Photo, row.photo],
      ['photos', f.Photos, row.photos],
    ]) {
      if (isMigratedAssetPaths(existing)) {
        report.plotPhotos.skipped += 1;
        continue;
      }
      const result = await uploadAirtableAttachments({
        plotId: row.id,
        attribute,
        attachments,
        dryRun: false,
      });
      for (const err of result.errors) {
        report.plotPhotos.errors.push({
          plotId: row.id,
          airtableId: rec.id,
          attribute,
          filename: err.filename,
          message: err.message,
        });
        report.errors.push({
          table: 'Plot',
          airtableId: rec.id,
          message: `${attribute}: ${err.message}`,
        });
      }
      // Leave existing value alone if any download/upload failed
      if (result.errors.length) {
        continue;
      }
      if (result.uploaded) {
        report.plotPhotos.uploaded += result.uploaded;
      } else {
        report.plotPhotos.cleared += 1;
      }
      photoUpdate[attribute] = result.paths;
    }
    if (Object.keys(photoUpdate).length) {
      await prisma.plot.update({
        where: { id: row.id },
        data: photoUpdate,
      });
    }
  }, idMaps.plot);

  // Dry-run: count intended Plot photo uploads (needs DATABASE_URL for skip accuracy)
  if (dryRun && fetched.plots.length && process.env.DATABASE_URL) {
    const { default: prismaDry } = await import('#prisma/client.js');
    try {
      const existingRows = await prismaDry.plot.findMany({
        select: { airtableId: true, photo: true, photos: true },
      });
      const existingByAirtableId = new Map(existingRows.map((r) => [r.airtableId, r]));
      for (const rec of fetched.plots) {
        const plotId = idMaps.plot.get(rec.id);
        if (!plotId) continue;
        const existing = existingByAirtableId.get(rec.id);
        for (const [attribute, attachments, existingVal] of [
          ['photo', rec.fields.Photo, existing?.photo],
          ['photos', rec.fields.Photos, existing?.photos],
        ]) {
          if (isMigratedAssetPaths(existingVal)) {
            report.plotPhotos.skipped += 1;
            continue;
          }
          const result = await uploadAirtableAttachments({
            plotId,
            attribute,
            attachments,
            dryRun: true,
          });
          if (result.uploaded) {
            report.plotPhotos.uploaded += result.uploaded;
          } else {
            report.plotPhotos.cleared += 1;
          }
        }
      }
    } finally {
      await prismaDry.$disconnect();
    }
  }

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

  /**
   * Resolve an Airtable link for FK writes.
   * - absent link → write null (Airtable cleared it)
   * - target map not ready (skipped/failed fetch) → skip write (preserve existing)
   * - link present but unknown in a ready map → report + skip write
   * - resolved → write UUID
   */
  function resolveFk (mapKey, map, airtableId, context) {
    if (!airtableId) return { write: true, value: null };
    if (!mapReady(mapKey)) return { write: false, value: undefined };
    const id = map.get(airtableId);
    if (!id) {
      report.unresolvedLinks.push(context);
      return { write: false, value: undefined };
    }
    return { write: true, value: id };
  }

  function resolveJoinId (mapKey, map, airtableId, context) {
    if (!airtableId || !mapReady(mapKey)) return null;
    const id = map.get(airtableId);
    if (!id) {
      report.unresolvedLinks.push(context);
      return null;
    }
    return id;
  }

  /** Upsert desired join rows and delete membership no longer present in Airtable. */
  async function syncJoinSet ({ desiredIds, upsertOne, deleteMissing }) {
    const desired = [...new Set(desiredIds.filter(Boolean))];
    if (dryRun) return;
    for (const targetId of desired) {
      await upsertOne(targetId);
    }
    await deleteMissing(desired);
  }

  // ---------- Pass 2: relations (only write when dependency maps are ready) ----------
  if (mapReady('neighborhoods') && mapReady('zipCodes')) {
    for (const rec of fetched.neighborhoods) {
      const neighborhoodId = idMaps.neighborhood.get(rec.id);
      if (!neighborhoodId) continue;
      const desiredZipIds = linkIds(rec.fields['Zip Codes']).map((zipAirtableId) => (
        resolveJoinId('zipCodes', idMaps.zipCode, zipAirtableId, {
          from: 'Neighborhoods', fromId: rec.id, field: 'Zip Codes', toId: zipAirtableId,
        })
      ));
      await syncJoinSet({
        desiredIds: desiredZipIds,
        upsertOne: async (zipCodeId) => {
          await prisma.neighborhoodZipCode.upsert({
            where: { neighborhoodId_zipCodeId: { neighborhoodId, zipCodeId } },
            create: { neighborhoodId, zipCodeId },
            update: {},
          });
        },
        deleteMissing: async (desired) => {
          await prisma.neighborhoodZipCode.deleteMany({
            where: {
              neighborhoodId,
              ...(desired.length ? { zipCodeId: { notIn: desired } } : {}),
            },
          });
        },
      });
    }
  }

  if (mapReady('people')) {
    for (const rec of fetched.people) {
      const personId = idMaps.person.get(rec.id);
      if (!personId) continue;
      const homeZip = resolveFk('zipCodes', idMaps.zipCode, firstLink(rec.fields.Zip), {
        from: 'People', fromId: rec.id, field: 'Zip', toId: firstLink(rec.fields.Zip),
      });
      if (!homeZip.write || dryRun) continue;
      await prisma.person.update({
        where: { id: personId },
        data: { homeZipId: homeZip.value },
      });
    }
  }

  if (mapReady('zipCodes') && mapReady('people')) {
    for (const rec of fetched.zipCodes) {
      const zipCodeId = idMaps.zipCode.get(rec.id);
      if (!zipCodeId) continue;
      const desiredPersonIds = linkIds(rec.fields['Local Volunteers']).map((personAirtableId) => (
        resolveJoinId('people', idMaps.person, personAirtableId, {
          from: 'Zip Codes', fromId: rec.id, field: 'Local Volunteers', toId: personAirtableId,
        })
      ));
      await syncJoinSet({
        desiredIds: desiredPersonIds,
        upsertOne: async (personId) => {
          await prisma.personZipCode.upsert({
            where: { personId_zipCodeId: { personId, zipCodeId } },
            create: { personId, zipCodeId },
            update: {},
          });
        },
        deleteMissing: async (desired) => {
          await prisma.personZipCode.deleteMany({
            where: {
              zipCodeId,
              ...(desired.length ? { personId: { notIn: desired } } : {}),
            },
          });
        },
      });
    }
  }

  if (mapReady('plots')) {
    for (const rec of fetched.plots) {
      const plotId = idMaps.plot.get(rec.id);
      if (!plotId) continue;

      const zipCode = resolveFk('zipCodes', idMaps.zipCode, firstLink(rec.fields['Zip Code']), {
        from: 'Plots', fromId: rec.id, field: 'Zip Code', toId: firstLink(rec.fields['Zip Code']),
      });
      const lastVolunteer = resolveFk('people', idMaps.person, firstLink(rec.fields['Last Volunteer']), {
        from: 'Plots', fromId: rec.id, field: 'Last Volunteer', toId: firstLink(rec.fields['Last Volunteer']),
      });
      const plotFkData = {};
      if (zipCode.write) plotFkData.zipCodeId = zipCode.value;
      if (lastVolunteer.write) plotFkData.lastVolunteerId = lastVolunteer.value;
      if (!dryRun && Object.keys(plotFkData).length) {
        await prisma.plot.update({
          where: { id: plotId },
          data: plotFkData,
        });
      }

      if (mapReady('neighborhoods')) {
        const desiredNeighborhoodIds = linkIds(rec.fields.Neighborhood).map((neighborhoodAirtableId) => (
          resolveJoinId('neighborhoods', idMaps.neighborhood, neighborhoodAirtableId, {
            from: 'Plots', fromId: rec.id, field: 'Neighborhood', toId: neighborhoodAirtableId,
          })
        ));
        await syncJoinSet({
          desiredIds: desiredNeighborhoodIds,
          upsertOne: async (neighborhoodId) => {
            await prisma.plotNeighborhood.upsert({
              where: { plotId_neighborhoodId: { plotId, neighborhoodId } },
              create: { plotId, neighborhoodId },
              update: {},
            });
          },
          deleteMissing: async (desired) => {
            await prisma.plotNeighborhood.deleteMany({
              where: {
                plotId,
                ...(desired.length ? { neighborhoodId: { notIn: desired } } : {}),
              },
            });
          },
        });
      }

      if (mapReady('people')) {
        const desiredPersonIds = linkIds(rec.fields['Assigned Volunteer/s']).map((personAirtableId) => (
          resolveJoinId('people', idMaps.person, personAirtableId, {
            from: 'Plots', fromId: rec.id, field: 'Assigned Volunteer/s', toId: personAirtableId,
          })
        ));
        await syncJoinSet({
          desiredIds: desiredPersonIds,
          upsertOne: async (personId) => {
            await prisma.plotAssignedVolunteer.upsert({
              where: { plotId_personId: { plotId, personId } },
              create: { plotId, personId },
              update: {},
            });
          },
          deleteMissing: async (desired) => {
            await prisma.plotAssignedVolunteer.deleteMany({
              where: {
                plotId,
                ...(desired.length ? { personId: { notIn: desired } } : {}),
              },
            });
          },
        });
      }
    }
  }

  if (mapReady('maintenance')) {
    for (const rec of fetched.maintenance) {
      const maintenanceRecordId = idMaps.maintenanceRecord.get(rec.id);
      if (!maintenanceRecordId) continue;

      const plot = resolveFk('plots', idMaps.plot, firstLink(rec.fields.Plot), {
        from: 'Maintenance Records', fromId: rec.id, field: 'Plot', toId: firstLink(rec.fields.Plot),
      });
      const volunteer = resolveFk('people', idMaps.person, firstLink(rec.fields.Volunteer), {
        from: 'Maintenance Records', fromId: rec.id, field: 'Volunteer', toId: firstLink(rec.fields.Volunteer),
      });
      const maintenanceFkData = {};
      if (plot.write) maintenanceFkData.plotId = plot.value;
      if (volunteer.write) maintenanceFkData.volunteerId = volunteer.value;
      if (!dryRun && Object.keys(maintenanceFkData).length) {
        await prisma.maintenanceRecord.update({
          where: { id: maintenanceRecordId },
          data: maintenanceFkData,
        });
      }

      if (mapReady('plants')) {
        const keptSlots = [];
        for (let slot = 1; slot <= 8; slot += 1) {
          const plantAirtableId = firstLink(rec.fields[`Plant ${slot}`]);
          if (!plantAirtableId) continue;
          const plantId = resolveJoinId('plants', idMaps.plant, plantAirtableId, {
            from: 'Maintenance Records', fromId: rec.id, field: `Plant ${slot}`, toId: plantAirtableId,
          });
          if (!plantId) continue;
          keptSlots.push(slot);
          if (dryRun) continue;
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
        if (!dryRun) {
          await prisma.maintenanceRecordPlant.deleteMany({
            where: {
              maintenanceRecordId,
              ...(keptSlots.length ? { slot: { notIn: keptSlots } } : {}),
            },
          });
        }
      }
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
