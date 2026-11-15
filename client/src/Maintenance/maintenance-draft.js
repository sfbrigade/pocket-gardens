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
  return { submissionId: draft.submissionId, plotId, date: draft.date, activity: draft.activity, observations: draft.observations, notes: draft.notes.trim(), photos: draft.photos.map(({ url, ...photo }) => photo), plants: draft.plants.map(({ label, ...plant }) => plant) };
}

export function maintenanceError (error) {
  return error.response?.data?.errors?.map(({ message }) => message).join('. ') || error.response?.data?.message || 'Unable to save. Your draft is kept here; try again.';
}
