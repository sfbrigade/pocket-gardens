import crypto from 'node:crypto';
import { errorCodes } from 'fastify';
import { z } from 'zod';

export const CarerUserIdsSchema = z.array(z.string().uuid()).refine((ids) => new Set(ids).size === ids.length, {
  message: 'This person is already selected',
});

export async function createPlotCarers (tx, plotId, userIds = []) {
  if (!userIds.length) return;
  const users = await tx.user.findMany({
    where: { id: { in: userIds }, banned: false, emailVerified: true },
    select: { id: true, firstName: true, lastName: true },
    orderBy: { id: 'asc' },
  });
  if (users.length !== userIds.length) {
    const error = errorCodes.FST_ERR_VALIDATION();
    error.validation = [{ params: { issue: { path: ['carerUserIds'], message: 'A selected carer is no longer available. Select an active registered user.' } } }];
    throw error;
  }
  const assignments = [];
  for (const user of users) {
    // Only the account ID establishes identity. Never infer an imported
    // volunteer's account from matching names or unverified contact details.
    const person = await tx.person.upsert({
      where: { userId: user.id },
      create: { userId: user.id, airtableId: `pg_${crypto.randomUUID()}`, firstName: user.firstName, lastName: user.lastName },
      update: { userId: user.id },
    });
    assignments.push({ plotId, personId: person.id });
  }
  await tx.plotAssignedVolunteer.createMany({ data: assignments });
}
