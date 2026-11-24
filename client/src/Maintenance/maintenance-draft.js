export const draftKey = (plotId, recordId = 'new') => `pocket-gardens:maintenance:${plotId}:${recordId}`;

export function readMaintenanceDraft (key) {
  if (!key) return null;
  try {
    const value = JSON.parse(window.sessionStorage.getItem(key));
    return value?.submissionId ? value : null;
  } catch { return null; }
}

export function clearMaintenanceDraft (key, submissionId) {
  if (!key) return;
  try {
    if (readMaintenanceDraft(key)?.submissionId === submissionId) window.sessionStorage.removeItem(key);
  } catch {}
}

export function newMaintenanceDraft (date) {
  return { submissionId: crypto.randomUUID(), date, activity: [], observations: [], notes: '', photos: [], plants: [], attempt: null };
}

export function selectObservations (previous, next) {
  const quiet = 'Nothing stood out';
  if (next.includes(quiet) && !previous.includes(quiet)) return [quiet];
  return next.filter((observation) => observation !== quiet);
}

export function maintenancePayload (draft, plotId) {
  return { submissionId: draft.submissionId, plotId, date: draft.date, activity: draft.activity, observations: draft.observations, notes: draft.notes.trim(), photos: draft.photos, plants: draft.plants.map(({ label, ...plant }) => plant) };
}

export function maintenanceError (error) {
  return error.response?.data?.errors?.map(({ message }) => message).join('. ') || error.response?.data?.message || 'Unable to save. Your draft is kept here; try again.';
}
