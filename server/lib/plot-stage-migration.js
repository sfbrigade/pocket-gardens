import { planPlotStageMigration } from '#lib/airtable-plot-stage.js';

export async function migratePlotStages (prisma, { apply = false, resolutions = {} } = {}) {
  return prisma.$transaction(async (tx) => {
    // Lock before reading so reviewed values cannot change during application.
    if (apply) await tx.$executeRaw`LOCK TABLE "Plot" IN EXCLUSIVE MODE`;
    const columns = await tx.$queryRaw`
      SELECT column_name FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'Plot'
        AND column_name IN ('status', 'stage', 'permissionStatus')
    `;
    if (!columns.some(({ column_name: name }) => name === 'status')) {
      return { alreadyMigrated: true, snapshot: [], updates: [], unresolved: [] };
    }
    // JSON access also permits preflight before the additive stage migration.
    const snapshot = await tx.$queryRaw`
      SELECT "airtableId", status, to_jsonb(p)->>'stage' AS stage,
        to_jsonb(p)->>'permissionStatus' AS "permissionStatus"
      FROM "Plot" p ORDER BY "airtableId"
    `;
    const plan = planPlotStageMigration(snapshot, resolutions);
    if (apply) {
      if (columns.length !== 3) throw new Error('Apply the additive plot-submission migration before applying stage resolutions');
      if (plan.unresolved.length) throw new Error('Resolve every reported plot before applying stage resolutions');
      for (const row of plan.updates) {
        await tx.$executeRaw`
          UPDATE "Plot" SET stage = ${row.stage}, "permissionStatus" = ${row.permissionStatus}
          WHERE "airtableId" = ${row.airtableId}
        `;
      }
    }
    return { alreadyMigrated: false, snapshot, ...plan };
  });
}
