import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createPlotDraft } from '../src/Plots/plot-form.js';
import { matchingPlotSubmission, preparePlotSubmission } from '../src/Plots/plot-submission.js';

const position = { latitude: 37.77, longitude: -122.43 };
const result = { position, address: '440 5th Avenue, San Francisco' };
const draft = () => ({ ...createPlotDraft(), position, locator: 'Second tree well' });
const restore = (values, suggestion) => JSON.parse(JSON.stringify({ ...values, submissionAttempt: preparePlotSubmission(values, suggestion) }));

test('refresh replays the attempted payload regardless of missing or changed suggestions', () => {
  for (const original of [undefined, result]) {
    const restored = restore(draft(), original);
    for (const suggestion of [undefined, result, { ...result, address: 'Different address' }]) {
      assert.deepEqual(preparePlotSubmission(restored, suggestion), restored.submissionAttempt);
    }
    const sameInputs = { ...restored, position: { ...position, accuracy: 5 }, locator: ' Second tree well ' };
    assert.deepEqual(matchingPlotSubmission(sameInputs), restored.submissionAttempt);
  }
});

test('intentional edits produce a new payload while retaining the submission identity', () => {
  const restored = restore(draft(), result);
  const edited = { ...restored, locator: 'Third tree well' };
  assert.equal(matchingPlotSubmission(edited), null);
  const next = preparePlotSubmission(edited, result);
  assert.equal(next.payload['Pocket Garden Name'], '440 5th Avenue · Third tree well');
  assert.equal(next.payload.submissionId, restored.submissionId);
  assert.notDeepEqual(next.payload, restored.submissionAttempt.payload);
});

test('explicitly clearing suggested fields survives refresh and reset requests a new suggestion', () => {
  const restored = restore({ ...draft(), addressEdited: true, nameEdited: true }, result);
  assert.equal(restored.submissionAttempt.payload['Street Address'], undefined);
  assert.equal(restored.submissionAttempt.payload['Pocket Garden Name'], undefined);
  assert.deepEqual(preparePlotSubmission(restored, result), restored.submissionAttempt);
  const reset = { ...restored, nameEdited: false };
  assert.equal(matchingPlotSubmission(reset), null);
  assert.equal(preparePlotSubmission(reset, result).payload['Pocket Garden Name'], 'Second tree well');
});
