export const draftKey = (plotId, recordId = 'new') => `pocket-gardens:maintenance:${plotId}:${recordId}`;

export function newMaintenanceDraft (date) {
  return { submissionId: crypto.randomUUID(), date, activity: [], observations: [], notes: '', photos: [], plants: [], attempt: null };
}

export function toggleObservation (selected, value) {
  if (value === 'Nothing stood out') return selected.includes(value) ? [] : [value];
  const next = selected.filter((item) => item !== 'Nothing stood out');
  return next.includes(value) ? next.filter((item) => item !== value) : [...next, value];
}

export function maintenancePayload (draft, plotId) {
  return { submissionId: draft.submissionId, plotId, ...editableMaintenanceFields(draft) };
}

export function editableMaintenanceFields (draft) {
  return {
    date: draft.date,
    activity: draft.activity,
    observations: draft.observations,
    notes: draft.notes.trim(),
    photos: draft.photos.map(({ id, upload }) => id ? { id } : { upload }),
    plants: draft.plants.map(({ plantId, newPlant, quantity }) => ({ ...(plantId ? { plantId } : { newPlant }), ...(quantity == null || quantity === '' ? {} : { quantity }) })),
  };
}

export function draftFromRecord (record) {
  const draft = { ...newMaintenanceDraft(''), date: record.date || '', notes: record.notes || '', activity: record.activity, observations: record.observations, plants: record.plants, photos: record.photos, version: record.version };
  return { ...draft, baseline: editableMaintenanceFields(draft) };
}

export function editMaintenancePayload (draft) {
  const changes = Object.fromEntries(Object.entries(editableMaintenanceFields(draft)).filter(([key, value]) => JSON.stringify(value) !== JSON.stringify(draft.baseline[key])));
  return { version: draft.version, mutationId: crypto.randomUUID(), ...changes };
}

export function maintenanceError (error) {
  return error.response?.data?.errors?.map(({ message }) => message).join('. ') || error.response?.data?.message || 'Unable to save. Your draft is kept here; try again.';
}
