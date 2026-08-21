/**
 * Join / plant-slot sync planning for Airtable → Postgres import.
 *
 * Unresolved links are preserved (not treated as cleared). Deletes only run
 * when every Airtable link in the set resolved to a UUID.
 */

/**
 * @param {string[]} linkAirtableIds - Airtable record ids present on the field
 * @param {(airtableId: string) => string|null|undefined} resolveId - returns UUID or null/undefined if unresolved
 * @returns {{ desiredIds: string[], shouldDeleteMissing: boolean, unresolvedIds: string[] }}
 */
export function buildJoinSyncPlan (linkAirtableIds, resolveId) {
  const desiredIds = [];
  const unresolvedIds = [];
  for (const airtableId of linkAirtableIds) {
    const id = resolveId(airtableId);
    if (!id) {
      unresolvedIds.push(airtableId);
      continue;
    }
    desiredIds.push(id);
  }
  return {
    desiredIds: [...new Set(desiredIds)],
    shouldDeleteMissing: unresolvedIds.length === 0,
    unresolvedIds,
  };
}

/**
 * @param {{ slot: number, plantAirtableId: string|null, plantId: string|null }[]} slots
 * @returns {{ keptSlots: number[], upserts: { slot: number, plantId: string }[] }}
 */
export function buildPlantSlotSyncPlan (slots) {
  const keptSlots = [];
  const upserts = [];
  for (const { slot, plantAirtableId, plantId } of slots) {
    if (!plantAirtableId) continue;
    // Unresolved: keep slot to preserve existing DB row; do not upsert.
    if (!plantId) {
      keptSlots.push(slot);
      continue;
    }
    keptSlots.push(slot);
    upserts.push({ slot, plantId });
  }
  return { keptSlots, upserts };
}
