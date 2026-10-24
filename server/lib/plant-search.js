import { Prisma } from '#prisma/client.js';
import { PLANT_PHOTOS_INCLUDE } from '#models/plant.js';

export async function searchPlants (prisma, { search, skip, take }) {
  // Matching and ranking happen before pagination, across the whole directory.
  const literal = search.replace(/[\\%_]/g, '\\$&').toLowerCase();
  const contains = `%${literal}%`;
  const prefix = `${literal}%`;
  const matches = await prisma.$queryRaw(Prisma.sql`
    SELECT id FROM "Plant"
    WHERE lower("plantName") LIKE ${contains} OR lower("commonName") LIKE ${contains} OR lower("latinName") LIKE ${contains}
      OR lower("plantName") % lower(${search}) OR lower("commonName") % lower(${search}) OR lower("latinName") % lower(${search})
    ORDER BY
      greatest(coalesce(lower("plantName") = lower(${search}), false)::int,
        coalesce(lower("commonName") = lower(${search}), false)::int, coalesce(lower("latinName") = lower(${search}), false)::int) DESC,
      greatest(coalesce(lower("plantName") LIKE ${prefix}, false)::int,
        coalesce(lower("commonName") LIKE ${prefix}, false)::int, coalesce(lower("latinName") LIKE ${prefix}, false)::int) DESC,
      greatest(similarity(lower("plantName"), lower(${search})), similarity(lower("commonName"), lower(${search})),
        similarity(lower("latinName"), lower(${search}))) DESC,
      coalesce("plantName", "commonName", "latinName", '') ASC, id ASC
    LIMIT ${take} OFFSET ${skip}
  `);
  const records = await prisma.plant.findMany({
    where: { id: { in: matches.map(({ id }) => id) } },
    include: PLANT_PHOTOS_INCLUDE,
  });
  const byId = new Map(records.map((record) => [record.id, record]));
  return matches.map(({ id }) => byId.get(id));
}
