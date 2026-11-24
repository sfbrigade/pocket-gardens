import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { Alert, Button, Checkbox, Container, Group, Loader, Stack, Text, Textarea, TextInput, Title } from '@mantine/core';
import { modals } from '@mantine/modals';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate, useParams, useLocation } from 'react-router';
import Api from '../Api';
import DraftRefreshGuard from '../Components/DraftRefreshGuard';
import MaintenancePhotos from './MaintenancePhotos';
import MaintenancePlants from './MaintenancePlants';
import { clearMaintenanceDraft, draftKey, readMaintenanceDraft, maintenanceError, maintenancePayload, newMaintenanceDraft, selectObservations, draftFromRecord, editMaintenancePayload, hasMaintenanceChanges } from './maintenance-draft';

function maintenanceRecordQuery (recordId) {
  return {
    queryKey: ['maintenance-record', recordId],
    queryFn: ({ signal }) => Api.maintenance.get(recordId, signal).then(({ data }) => data),
    retry: false,
  };
}

export default function MaintenanceForm () {
  const { plotId, recordId } = useParams();
  const garden = useQuery({ queryKey: ['plot', plotId], queryFn: ({ signal }) => Api.plots.get(plotId, signal).then(({ data }) => data) });
  const record = useQuery({ ...maintenanceRecordQuery(recordId), enabled: !!recordId });
  if (recordId && record.isPending) return <Container><Loader aria-label='Loading saved update' /></Container>;
  if (garden.isPending) return <Container><Loader aria-label='Loading update form' /></Container>;
  if (!garden.data) return <Container><Alert color='red'>Unable to load this garden. <Button onClick={() => garden.refetch()}>Try again</Button></Alert></Container>;

  const gardenId = garden.data.id;
  const storageKey = draftKey(gardenId, recordId);
  const previousKey = plotId !== gardenId ? draftKey(plotId, recordId) : null;
  const composerKey = `${gardenId}:${recordId || 'new'}`;
  const recordUnavailable = !!(recordId && record.isError && record.error.response?.status === 404);
  if (recordId && !record.data) {
    if (recordUnavailable) return <UnavailableMaintenanceUpdate key={composerKey} plotId={gardenId} storageKey={storageKey} previousKey={previousKey} />;
    return <Container><Alert color='red'>Unable to load the saved update.</Alert><Button component={Link} to={`/plots/${encodeURIComponent(gardenId)}?tab=updates`}>Back to updates</Button></Container>;
  }
  return <MaintenanceComposer key={composerKey} plotId={gardenId} garden={garden} recordId={recordId} initialRecord={recordId ? record.data : null} recordUnavailable={recordUnavailable} storageKey={storageKey} previousKey={previousKey} />;
}

function UnavailableMaintenanceUpdate ({ plotId, storageKey, previousKey, currentDraft }) {
  const [draft, setDraft] = useState(() => currentDraft ?? readMaintenanceDraft(storageKey) ?? readMaintenanceDraft(previousKey));
  const modalId = useId();
  useEffect(() => () => modals.close(modalId), [modalId]);

  function discard () {
    modals.openConfirmModal({
      modalId,
      title: 'Discard this local draft?',
      labels: { confirm: 'Discard draft', cancel: 'Keep draft' },
      confirmProps: { color: 'red' },
      onConfirm: () => {
        clearMaintenanceDraft(storageKey, draft.submissionId);
        clearMaintenanceDraft(previousKey, draft.submissionId);
        setDraft(null);
      },
    });
  }

  return (
    <Container size='sm'>
      <Stack>
        <Alert>This update is no longer available in this garden.</Alert>
        {draft && hasMaintenanceChanges(draft) && (
          <Stack gap='xs'>
            <DraftRefreshGuard />
            <Title order={2}>Unsaved draft</Title>
            <Text>Copy any details you want to keep.</Text>
            {draft.date && <Text>Visit date {draft.date}</Text>}
            {!!draft.activity.length && <Text>{draft.activity.join(', ')}</Text>}
            {!!draft.observations.length && <Text>{draft.observations.join(', ')}</Text>}
            {draft.notes && <Text style={{ whiteSpace: 'pre-wrap' }}>{draft.notes}</Text>}
            {draft.plants.map((plant, index) => (
              <Text key={index}>{plant.label || plant.name || plant.newPlant?.plantName}{plant.quantity ? ` × ${plant.quantity}` : ''}</Text>
            ))}
            <Button variant='light' color='red' onClick={discard}>Discard local draft</Button>
          </Stack>
        )}
        <Button component={Link} to={`/plots/${encodeURIComponent(plotId)}?tab=updates`}>Back to updates</Button>
      </Stack>
    </Container>
  );
}

function MaintenanceComposer ({ plotId, garden, recordId, initialRecord, recordUnavailable, storageKey, previousKey }) {
  const editing = !!recordId;
  const draftModalId = useId();
  const navigate = useNavigate();
  const location = useLocation();
  const quickRequested = new URLSearchParams(location.search).get('quick') === 'photo';
  const client = useQueryClient();
  const capabilities = useQuery({ queryKey: ['maintenance-capabilities'], queryFn: ({ signal }) => Api.maintenance.capabilities(signal).then(({ data }) => data) });
  const [draft, setDraft] = useState(() => {
    const restored = readMaintenanceDraft(storageKey) || readMaintenanceDraft(previousKey);
    if (restored) return restored;
    return initialRecord ? draftFromRecord(initialRecord) : newMaintenanceDraft('');
  });
  const [{ busy: photoBusy, failed: photoFailed }, setUploadState] = useState({ busy: false, failed: false });
  const quick = quickRequested && !(draft.notes || draft.activity.length || draft.observations.length || draft.plants.length);
  const uploadsPending = !!draft.uploadsPending || photoBusy || photoFailed;
  const hasDraftContent = editing
    ? uploadsPending || hasMaintenanceChanges(draft)
    : !!(draft.attempt || draft.notes || draft.activity.length || draft.observations.length || draft.photos.length || draft.plants.length || uploadsPending);
  const [formError, setFormError] = useState('');
  const [conflicted, setConflicted] = useState(false);
  const [reloading, setReloading] = useState(false);
  const [deleted, setDeleted] = useState(false);
  const [storageError, setStorageError] = useState(false);
  const submitting = useRef(false);
  const persistDraft = useCallback((value) => {
    try {
      window.sessionStorage.setItem(storageKey, JSON.stringify(value));
      clearMaintenanceDraft(previousKey, value.submissionId);
      setStorageError(false);
      return true;
    } catch {
      setStorageError(true);
      return false;
    }
  }, [previousKey, storageKey]);
  const mutation = useMutation({
    mutationFn: ({ payload }) => editing ? Api.maintenance.update(recordId, payload) : Api.maintenance.create(payload),
    onSuccess: ({ data }, { submissionId, gardenId }) => {
      clearMaintenanceDraft(storageKey, submissionId);
      clearMaintenanceDraft(previousKey, submissionId);
      client.setQueryData(['maintenance-record', data.id], data);
      client.invalidateQueries({ queryKey: ['maintenance', gardenId], exact: true });
    },
  });
  const saved = mutation.isSuccess ? mutation.data.data : null;
  const saving = mutation.isPending;
  const error = formError || (mutation.error ? maintenanceError(mutation.error) : '');
  const refreshGuard = hasDraftContent && !saved && <DraftRefreshGuard />;
  useEffect(() => () => modals.close(draftModalId), [draftModalId]);
  useEffect(() => { if (!editing && !draft.date && capabilities.data) setDraft((value) => ({ ...value, date: capabilities.data.today })); }, [capabilities.data, draft.date, editing]);
  useEffect(() => {
    if (saved || (editing && (deleted || recordUnavailable))) return;
    if (editing && !hasDraftContent) {
      clearMaintenanceDraft(storageKey, draft.submissionId);
      clearMaintenanceDraft(previousKey, draft.submissionId);
      if (draft.version !== initialRecord.version) {
        setDraft((current) => current === draft ? draftFromRecord(initialRecord) : current);
      }
      return;
    }
    persistDraft({ ...draft, uploadsPending });
  }, [deleted, draft, editing, hasDraftContent, initialRecord, persistDraft, previousKey, recordUnavailable, saved, storageKey, uploadsPending]);

  function submit (event) {
    event.preventDefault();
    if (submitting.current || saving || !canSubmit) return;
    if (quick && !draft.attempt && !draft.photos.length) { setFormError('Add a photo first, or choose Add more details.'); return; }
    const payload = draft.attempt || (editing ? editMaintenancePayload(draft) : maintenancePayload(draft, plotId));
    if (editing && Object.keys(payload).length === 2) { setFormError('Make at least one change before saving.'); return; }
    const attempted = { ...draft, attempt: payload, uploadsPending: false };
    if (editing && !draft.attempt && payload.photos && draft.baseline.photos.some(({ id }) => !payload.photos.some((photo) => photo.id === id))) {
      modals.openConfirmModal({
        modalId: draftModalId,
        title: 'Permanently erase the removed photos when this edit saves?',
        labels: { confirm: 'Save and erase photos', cancel: 'Keep editing' },
        confirmProps: { color: 'red' },
        onConfirm: () => saveAttempt(attempted),
      });
      return;
    }
    saveAttempt(attempted);
  }

  function saveAttempt (attempted) {
    if (submitting.current || !persistDraft(attempted)) return;
    submitting.current = true;
    setDraft(attempted);
    setFormError('');
    mutation.mutate({ payload: attempted.attempt, submissionId: attempted.submissionId, gardenId: garden.data.id }, {
      onError: (failure) => {
        const status = failure.response?.status;
        if (editing && status === 409) setConflicted(true);
        if (status === 404 || status === 410) setDeleted(true);
        if ([409, 422].includes(status)) setDraft((value) => ({ ...value, attempt: null }));
      },
      onSettled: () => { submitting.current = false; },
    });
  }

  function discard () {
    if (saving || reloading) return;
    if (conflicted) { loadLatest(); return; }
    modals.openConfirmModal({
      modalId: draftModalId,
      title: 'Discard this local draft?',
      children: draft.attempt && <Text>A previous save might have succeeded. Any saved update stays in garden history. Review the history before starting again.</Text>,
      labels: { confirm: 'Discard draft', cancel: 'Keep draft' },
      confirmProps: { color: 'red' },
      onConfirm: () => {
        const replacement = initialRecord ? draftFromRecord(initialRecord) : newMaintenanceDraft(capabilities.data.today);
        persistDraft(replacement);
        setDraft(replacement);
        setDeleted(false);
        mutation.reset();
        setFormError('');
      },
    });
  }

  function cancel () {
    if (saving) return;
    if (hasDraftContent && !window.confirm(draft.attempt ? 'The save may have succeeded. Keep this draft and return to garden history?' : 'Leave this update? Your draft will be kept in this tab.')) return;
    navigate(`/plots/${encodeURIComponent(plotId)}?tab=updates`);
  }

  function loadLatest () {
    if (reloading) return;
    modals.openConfirmModal({
      modalId: draftModalId,
      title: 'Replace this unsaved draft with the latest saved update?',
      labels: { confirm: 'Replace draft', cancel: 'Keep draft' },
      onConfirm: async () => {
        setReloading(true);
        try {
          const record = await client.fetchQuery({ ...maintenanceRecordQuery(recordId), staleTime: 0 });
          clearMaintenanceDraft(storageKey, draft.submissionId);
          clearMaintenanceDraft(previousKey, draft.submissionId);
          setDraft(draftFromRecord(record));
          setConflicted(false);
          mutation.reset();
          setFormError('');
        } catch (failure) {
          setFormError(maintenanceError(failure));
          if (failure.response?.status === 404) setDeleted(true);
        } finally {
          setReloading(false);
        }
      },
    });
  }
  if (capabilities.isPending || garden.isPending) return <Container>{refreshGuard}<Loader aria-label='Loading update form' /></Container>;
  if (capabilities.isError || garden.isError) return <Container>{refreshGuard}<Alert color='red'>Unable to load this garden. <Button onClick={() => { capabilities.refetch(); garden.refetch(); }}>Try again</Button></Alert></Container>;
  const canUseForm = editing ? capabilities.data.canManage : capabilities.data.canCreate;
  if (!canUseForm) return <Container>{refreshGuard}<Alert>{editing ? 'Only administrators can edit updates.' : 'Sign in with a verified account to add an update.'}</Alert><Button component={Link} to={`/plots/${encodeURIComponent(plotId)}?tab=updates`}>Back to garden</Button></Container>;
  if (editing && initialRecord.gardenId !== plotId) return <Container><Alert>This update is no longer available in this garden.</Alert><Button component={Link} to={`/plots/${encodeURIComponent(plotId)}?tab=updates`}>Back to updates</Button></Container>;
  if (editing && (deleted || recordUnavailable)) return <UnavailableMaintenanceUpdate plotId={plotId} storageKey={storageKey} previousKey={previousKey} currentDraft={draft} />;
  if (deleted) return <Container>{refreshGuard}<Alert>This update is no longer available in this garden.</Alert><Button variant='light' onClick={discard}>Discard local draft</Button><Button component={Link} to={`/plots/${encodeURIComponent(plotId)}?tab=updates`}>Back to updates</Button></Container>;
  if (saved) return <Container size='sm'><Stack><Title order={2}>{editing ? 'Update corrected' : 'Update saved'}</Title><Text>Saved to this garden’s history.</Text>{saved.cleanupPending && <Alert color='yellow'>The edit is saved. Permanent photo erasure is pending and will be retried.</Alert>}<Text>{saved.activity.join(', ')}</Text><Text>{saved.observations.join(', ')}</Text><Text style={{ whiteSpace: 'pre-wrap' }}>{saved.notes}</Text><Text>{saved.photos?.length || 0} photos attached to this update.</Text>{saved.plants?.map((plant) => <Text key={plant.plantId}>{plant.name}{plant.quantity == null ? '' : ` × ${plant.quantity}`}</Text>)}<Button component={Link} to={`/plots/${encodeURIComponent(plotId)}?tab=updates`}>Back to updates</Button><Button variant='light' onClick={() => { if (editing) navigate(`/plots/${encodeURIComponent(plotId)}/updates/new`); else { mutation.reset(); setDraft(newMaintenanceDraft(capabilities.data.today)); } }}>Add another update</Button></Stack></Container>;
  const locked = saving || reloading || !!draft.attempt;
  const paused = !editing && garden.data.stage === 'paused';
  const eligible = editing || ['potential', 'preparing', 'active', 'paused'].includes(garden.data.stage);
  const hasPausedWork = paused && (draft.activity.length > 0 || draft.plants.length > 0);
  const canSubmit = !photoBusy && !photoFailed && !conflicted && (!!draft.attempt || (eligible && !hasPausedWork));
  // Unchanged imported dates are omitted from PATCH, including legacy future
  // dates. Apply the current date limit when selecting a new value.
  const dateUnchanged = editing && draft.date === draft.baseline.date;
  return (
    <Container size='sm' py='md'>
      {refreshGuard}
      <form onSubmit={submit}>
        <Stack>
          <Title order={2}>{editing ? 'Edit update' : 'Add an update'}</Title>
          <Alert color='green'>Updating {garden.data['Pocket Garden Name'] || 'Pocket garden'} · {plotId}</Alert>
          {!eligible && <Alert>This garden is not accepting new updates.{draft.attempt && ' Retry the prior save to check whether it succeeded.'}</Alert>}
          {paused && <Text>This garden is paused. You can record observations, notes, and photos.</Text>}
          {hasPausedWork && (
            <Alert color='yellow'>
              This draft contains work selections from before the garden was paused.
              <Button type='button' variant='subtle' disabled={locked} onClick={() => setDraft((value) => ({ ...value, activity: [], plants: [] }))}>Remove work selections</Button>
            </Alert>
          )}
          {storageError && <Alert color='yellow'>This browser could not store your draft. Make browser storage available and try saving again.</Alert>}
          <TextInput type='date' label='When did this happen?' required={!editing || !!draft.baseline.date} max={dateUnchanged ? undefined : capabilities.data.today} value={draft.date} disabled={locked} onChange={(event) => { const date = event.currentTarget.value; setDraft((draft) => ({ ...draft, date })); }} />
          {!quick && !paused && <Checkbox.Group label='What did you do?' value={draft.activity} onChange={(activity) => setDraft((draft) => ({ ...draft, activity }))}><Stack gap='xs'>{[...new Set([...capabilities.data.activities, ...draft.activity])].map((activity) => <Checkbox key={activity} label={activity} value={activity} disabled={locked} />)}</Stack></Checkbox.Group>}
          {!quick && !paused && (draft.activity.includes('Planted') || draft.plants.length > 0) && <MaintenancePlants plants={draft.plants} disabled={locked} onChange={(plants) => setDraft((draft) => ({ ...draft, plants }))} />}
          {!quick && (
            <Checkbox.Group label='What did you see?' value={draft.observations} disabled={locked} onChange={(observations) => setDraft((current) => ({ ...current, observations: selectObservations(current.observations, observations) }))}>
              <Stack gap='xs'>{capabilities.data.observations.map((observation) => <Checkbox key={observation} label={observation} value={observation} />)}</Stack>
            </Checkbox.Group>
          )}
          {draft.uploadsPending && <Alert color='yellow'>A previous photo upload was interrupted. Reattach unfinished photos or continue without them.</Alert>}
          <MaintenancePhotos key={draft.submissionId} photos={draft.photos} disabled={locked} onUploadStateChange={setUploadState} onChange={(photos) => setDraft((value) => ({ ...value, photos: typeof photos === 'function' ? photos(value.photos) : photos }))} />
          {quick && <Button variant='subtle' disabled={locked} onClick={() => navigate(location.pathname, { replace: true })}>Add more details</Button>}
          {!quick && <Textarea label='Anything to add?' value={draft.notes} disabled={locked} onChange={(event) => { const notes = event.currentTarget.value; setDraft((draft) => ({ ...draft, notes })); }} autosize minRows={3} />}
          {conflicted && <Alert color='yellow'>Your draft has been preserved. <Button type='button' variant='subtle' loading={reloading} onClick={loadLatest}>Load latest update</Button></Alert>}
          {error && <Alert color='red' role='alert'>{error}{draft.attempt && <Text size='sm'>Retry sends the same attempted update. Review garden history if you no longer want to retry.</Text>}</Alert>}
          <Group><Button type='submit' loading={saving} disabled={!canSubmit}>{draft.attempt ? 'Try again' : editing ? 'Save changes' : 'Add this update'}</Button><Button variant='subtle' disabled={saving} onClick={cancel}>Cancel</Button><Button variant='subtle' color='red' disabled={saving} onClick={discard}>Discard local draft</Button></Group>
        </Stack>
      </form>
    </Container>
  );
}
