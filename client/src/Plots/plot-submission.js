import { plotPayload } from './plot-form.js';
import { resolvePlotIdentification } from './plot-identification.js';

function draftKey (values) {
  return JSON.stringify({
    ...plotPayload(values),
    addressEdited: !!values.addressEdited,
    nameEdited: !!values.nameEdited,
  });
}

export function matchingPlotSubmission (values) {
  const attempt = values.submissionAttempt;
  return attempt?.draftKey === draftKey(values) && attempt.payload?.submissionId === values.submissionId
    ? attempt
    : null;
}

export function preparePlotSubmission (values, result) {
  // A restored, unchanged draft must replay the attempted request even if lookup results change.
  return matchingPlotSubmission(values) ?? {
    draftKey: draftKey(values),
    payload: JSON.parse(JSON.stringify(plotPayload({ ...values, ...resolvePlotIdentification(values, result) }))),
  };
}

export function changePlotPhoto (values, photo) {
  const attempt = matchingPlotSubmission(values);
  return {
    photo,
    // Changing only the photo must keep the identification shown for this
    // attempt, even after refresh when the address lookup is unavailable.
    submissionAttempt: attempt
      ? {
          draftKey: draftKey({ ...values, photo }),
          payload: { ...attempt.payload, Photos: photo ? [photo] : undefined },
        }
      : null,
  };
}
