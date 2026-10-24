import crypto from 'node:crypto';
import { errorCodes } from 'fastify';
import { z } from 'zod';

import { PlantCreateFieldsSchema, plantFieldsFromBody } from '#models/plant.js';

const NewPlantSchema = PlantCreateFieldsSchema.pick({ plantName: true, commonName: true, latinName: true });

const PlotPlantInputSchema = z.strictObject({
  plantId: z.string().uuid().optional(),
  newPlant: NewPlantSchema.optional(),
  quantity: z.number().int().nonnegative().optional(),
  notes: z.string().trim().optional(),
}).refine(({ plantId, newPlant }) => !!plantId !== !!newPlant, {
  message: 'Select an existing plant or explicitly add a new plant',
});

export const PlotPlantsInputSchema = z.array(PlotPlantInputSchema).superRefine((entries, ctx) => {
  const seen = new Set();
  entries.forEach((entry, index) => {
    const key = entry.plantId ?? JSON.stringify(entry.newPlant);
    if (seen.has(key)) ctx.addIssue({ code: 'custom', path: [index], message: 'This plant is already in the plot' });
    seen.add(key);
  });
});

export const PlotPlantSchema = z.strictObject({
  plantId: z.string().uuid(),
  plantName: z.string().nullable(),
  commonName: z.string().nullable(),
  latinName: z.string().nullable(),
  quantity: z.number().int().nullable(),
  notes: z.string().nullable(),
  state: z.enum(['planned', 'current']),
});

export async function createPlotPlants (tx, plot, entries = []) {
  const ids = entries.flatMap(({ plantId }) => plantId ? [plantId] : []);
  if (ids.length && await tx.plant.count({ where: { id: { in: ids } } }) !== ids.length) {
    const error = errorCodes.FST_ERR_VALIDATION();
    error.validation = [{ params: { issue: { path: ['plants'], message: 'A selected plant no longer exists' } } }];
    throw error;
  }
  for (const entry of entries) {
    let plantId = entry.plantId;
    if (entry.newPlant) {
      const plant = await tx.plant.create({
        data: { airtableId: `pg_${crypto.randomUUID()}`, ...plantFieldsFromBody(entry.newPlant) },
      });
      plantId = plant.id;
    }
    await tx.plotPlant.create({
      data: {
        plotId: plot.id,
        plantId,
        quantity: entry.quantity,
        notes: entry.notes,
        state: plot.stage === 'active' ? 'current' : 'planned',
      },
    });
  }
}
