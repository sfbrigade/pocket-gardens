import { useCallback, useEffect, useId, useState } from 'react';
import { Alert, Button, Checkbox, Container, Group, Loader, Stack, Text, Textarea, TextInput, Title } from '@mantine/core';
import { useForm } from '@mantine/form';
import { modals } from '@mantine/modals';
import { useMutation, useMutationState, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate, useParams, useLocation } from 'react-router';
import Api from '../Api';
import DraftRefreshGuard from '../Components/DraftRefreshGuard';
import { plotQueryOptions } from '../plots';
import MaintenancePhotos from './MaintenancePhotos';
import MaintenancePlants from './MaintenancePlants';
import { clearMaintenanceDraft, draftKey, readMaintenanceDraft, maintenanceError, maintenancePayload, newMaintenanceDraft, selectObservations, draftFromRecord, editMaintenancePayload, hasMaintenanceChanges } from './maintenance-draft';
import { useMaintenanceCapabilities } from './maintenance-queries';

function maintenanceRecordQuery (recordId) {
  return {
    queryKey: ['maintenance-record', recordId],
    queryFn: ({ signal }) => Api.maintenance.get(recordId, signal).then(({ data }) => data),
    retry: false,
  };
}

export default function MaintenanceForm () {
  const { plotId, recordId } = useParams();
  const { account, authPending, capabilities } = useMaintenanceCapabilities();
  const garden = useQuery(plotQueryOptions(plotId));
  const record = useQuery({
    ...maintenanceRecordQuery(recordId),
    enabled: !!recordId && !authPending && !!capabilities.data?.canManage,
  });
  if (authPending || capabilities.isPending || garden.isPending) return <Container><Loader aria-label='Loading update form' /></Container>;
  if (!garden.data) return <Container><Alert color='red'>Unable to load this garden. <Button onClick={() => garden.refetch()}>Try again</Button></Alert></Container>;
  if (!capabilities.data) return <Container><Alert color='red'>Unable to check update access. <Button onClick={() => capabilities.refetch()}>Try again</Button></Alert></Container>;

  const gardenId = garden.data.id;
  const allowed = recordId ? capabilities.data.canManage : capabilities.data.canCreate;
  if (!allowed) return <Container><Alert>{recordId ? 'Only administrators can edit updates.' : 'Sign in with a verified account to add an update.'}</Alert><Button component={Link} to={`/plots/${encodeURIComponent(gardenId)}?tab=updates`}>Back to garden</Button></Container>;
  if (recordId && record.isPending) return <Container><Loader aria-label='Loading saved update' /></Container>;

  const storageKey = draftKey(account, gardenId, recordId);
  const previousKey = plotId !== gardenId ? draftKey(account, plotId, recordId) : null;
  const recordUnavailable = !!(recordId && record.isError && record.error.response?.status === 404);
  if (recordId && !record.data) {
    if (recordUnavailable) return <UnavailableMaintenanceUpdate key={storageKey} plotId={gardenId} storageKey={storageKey} previousKey={previousKey} />;
    return <Container><Alert color='red'>Unable to load the saved update. <Button onClick={() => record.refetch()}>Try again</Button></Alert><Button component={Link} to={`/plots/${encodeURIComponent(gardenId)}?tab=updates`}>Back to updates</Button></Container>;
  }
  return <MaintenanceComposer key={storageKey} plotId={gardenId} garden={garden} capabilities={capabilities} recordId={recordId} record={record} recordUnavailable={recordUnavailable} storageKey={storageKey} previousKey={previousKey} />;
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

function MaintenanceComposer ({ plotId, garden, capabilities, recordId, record, recordUnavailable, storageKey, previousKey }) {
  const editing = !!recordId;
  const initialRecord = editing ? record.data : null;
  const { today } = capabilities.data;
  const draftModalId = useId();
  const navigate = useNavigate();
  const location = useLocation();
  const quickRequested = new URLSearchParams(location.search).get('quick') === 'photo';
  const client = useQueryClient();
  const [initialDraft] = useState(() => (
    readMaintenanceDraft(storageKey) ?? readMaintenanceDraft(previousKey) ??
    (initialRecord ? draftFromRecord(initialRecord) : newMaintenanceDraft(today))
  ));
  const form = useForm({ initialValues: initialDraft });
  const { values: draft, getValues, setFieldValue, setInitialValues, reset } = form;
  const replaceDraft = useCallback((nextDraft) => {
    setInitialValues(nextDraft);
    reset();
  }, [setInitialValues, reset]);
  const [{ busy: photoBusy, failed: photoFailed }, setUploadState] = useState({ busy: false, failed: false });
  const [detailsExpanded, setDetailsExpanded] = useState(() => (
    !quickRequested || !!(initialDraft.notes || initialDraft.activity.length || initialDraft.observations.length || initialDraft.plants.length)
  ));
  const quick = !editing && quickRequested && !detailsExpanded;
  const uploadsPending = !!draft.uploadsPending || photoBusy || photoFailed;
  const hasDraftContent = editing
    ? uploadsPending || hasMaintenanceChanges(draft)
    : !!(draft.attempt || draft.date !== today || draft.notes || draft.activity.length || draft.observations.length || draft.photos.length || draft.plants.length || uploadsPending);
  const [formError, setFormError] = useState('');
  const [storageError, setStorageError] = useState(false);
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
  const mutationKey = ['maintenance-save', storageKey];
  const saveFilter = { mutationKey, exact: true };
  const mutation = useMutation({
    mutationKey,
    mutationFn: ({ payload }) => editing ? Api.maintenance.update(recordId, payload) : Api.maintenance.create(payload),
    onSuccess: ({ data }, { submissionId }) => {
      clearMaintenanceDraft(storageKey, submissionId);
      clearMaintenanceDraft(previousKey, submissionId);
      client.setQueryData(['maintenance-record', data.id], data);
      client.invalidateQueries({ queryKey: ['maintenance', plotId], exact: true });
    },
  });
  const saves = useMutationState({ filters: saveFilter });
  const latestSave = saves.findLast(({ variables }) => variables?.submissionId === draft.submissionId);
  const saved = latestSave?.data?.data;
  const saving = latestSave?.status === 'pending';
  const failure = latestSave?.error;
  const status = failure?.response?.status;
  const conflicted = status === 409;
  const deleted = status === 404 || status === 410;
  const reloading = editing && conflicted && record.isFetching;
  const error = formError || (failure ? maintenanceError(failure) : '');
  const refreshGuard = hasDraftContent && !saved && <DraftRefreshGuard />;
  useEffect(() => () => modals.close(draftModalId), [draftModalId]);
  useEffect(() => {
    if (saved || saving || deleted || recordUnavailable) return;
    if (draft.attempt && (status === 422 || (editing && conflicted))) {
      setFieldValue('attempt', null);
      return;
    }
    if (!hasDraftContent) {
      clearMaintenanceDraft(storageKey, draft.submissionId);
      clearMaintenanceDraft(previousKey, draft.submissionId);
      if (editing && draft.version !== initialRecord.version && getValues() === draft) {
        replaceDraft(draftFromRecord(initialRecord));
      }
      return;
    }
    persistDraft({ ...draft, uploadsPending });
  }, [conflicted, deleted, draft, editing, getValues, hasDraftContent, initialRecord, persistDraft, previousKey, recordUnavailable, replaceDraft, saved, saving, setFieldValue, status, storageKey, uploadsPending]);

  function submit (draft) {
    if (!canSubmit || client.isMutating(saveFilter)) return;
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
    if (client.isMutating(saveFilter) || !persistDraft(attempted)) return;
    setFieldValue('attempt', attempted.attempt);
    setFieldValue('uploadsPending', false);
    setFormError('');
    mutation.mutate({ payload: attempted.attempt, submissionId: attempted.submissionId });
  }

  function discard () {
    if (saving || reloading) return;
    if (editing && conflicted) { loadLatest(); return; }
    modals.openConfirmModal({
      modalId: draftModalId,
      title: 'Discard this local draft?',
      children: draft.attempt && <Text>A previous save might have succeeded. Any saved update stays in garden history. Review the history before starting again.</Text>,
      labels: { confirm: 'Discard draft', cancel: 'Keep draft' },
      confirmProps: { color: 'red' },
      onConfirm: () => {
        clearMaintenanceDraft(storageKey, draft.submissionId);
        clearMaintenanceDraft(previousKey, draft.submissionId);
        replaceDraft(initialRecord ? draftFromRecord(initialRecord) : newMaintenanceDraft(today));
        setFormError('');
      },
    });
  }

  function cancel () {
    if (saving) return;
    const goBack = () => navigate(`/plots/${encodeURIComponent(plotId)}?tab=updates`);
    if (!hasDraftContent) { goBack(); return; }
    modals.openConfirmModal({
      modalId: draftModalId,
      title: 'Leave this update?',
      children: <Text>{draft.attempt ? 'The save may have succeeded. You can review garden history and return to this draft.' : 'Your draft will be kept in this tab.'}</Text>,
      labels: { confirm: 'Return to updates', cancel: 'Keep editing' },
      onConfirm: goBack,
    });
  }

  function loadLatest () {
    if (reloading) return;
    modals.openConfirmModal({
      modalId: draftModalId,
      title: 'Replace this unsaved draft with the latest saved update?',
      labels: { confirm: 'Replace draft', cancel: 'Keep draft' },
      onConfirm: async () => {
        try {
          const { data: latest } = await record.refetch({ throwOnError: true });
          clearMaintenanceDraft(storageKey, draft.submissionId);
          clearMaintenanceDraft(previousKey, draft.submissionId);
          replaceDraft(draftFromRecord(latest));
          setFormError('');
        } catch {
          setFormError('Unable to reload the saved update. Try again.');
        }
      },
    });
  }
  if (editing && initialRecord.gardenId !== plotId) return <Container><Alert>This update is no longer available in this garden.</Alert><Button component={Link} to={`/plots/${encodeURIComponent(plotId)}?tab=updates`}>Back to updates</Button></Container>;
  if (editing && (deleted || recordUnavailable)) return <UnavailableMaintenanceUpdate plotId={plotId} storageKey={storageKey} previousKey={previousKey} currentDraft={draft} />;
  if (deleted) return <Container>{refreshGuard}<Alert>This update is no longer available in this garden.</Alert><Button variant='light' onClick={discard}>Discard local draft</Button><Button component={Link} to={`/plots/${encodeURIComponent(plotId)}?tab=updates`}>Back to updates</Button></Container>;
  if (saved) return <Container size='sm'><Stack><Title order={2}>{editing ? 'Update corrected' : 'Update saved'}</Title><Text>Saved to this garden’s history.</Text>{saved.cleanupPending && <Alert color='yellow'>The edit is saved. Permanent photo erasure is pending and will be retried.</Alert>}<Text>{saved.activity.join(', ')}</Text><Text>{saved.observations.join(', ')}</Text><Text style={{ whiteSpace: 'pre-wrap' }}>{saved.notes}</Text><Text>{saved.photos?.length || 0} photos attached to this update.</Text>{saved.plants?.map((plant) => <Text key={plant.id || plant.plantId}>{plant.name}{plant.quantity == null ? '' : ` × ${plant.quantity}`}</Text>)}<Button component={Link} to={`/plots/${encodeURIComponent(plotId)}?tab=updates`}>Back to updates</Button><Button variant='light' onClick={() => { if (editing) navigate(`/plots/${encodeURIComponent(plotId)}/updates/new`); else replaceDraft(newMaintenanceDraft(today)); }}>Add another update</Button></Stack></Container>;
  const locked = saving || reloading || !!draft.attempt;
  const paused = !editing && garden.data.stage === 'paused';
  const eligible = editing || ['potential', 'preparing', 'active', 'paused'].includes(garden.data.stage);
  const hasPausedWork = paused && (draft.activity.length > 0 || draft.plants.length > 0);
  const canSubmit = !saving && !photoBusy && !photoFailed && !conflicted && (!!draft.attempt || (eligible && !hasPausedWork));
  // Unchanged imported dates are omitted from PATCH, including legacy future
  // dates. Apply the current date limit when selecting a new value.
  const dateUnchanged = editing && draft.date === draft.baseline.date;
  return (
    <Container size='sm' py='md'>
      {refreshGuard}
      <form onSubmit={form.onSubmit(submit)}>
        <Stack>
          <Title order={2}>{editing ? 'Edit update' : 'Add an update'}</Title>
          <Alert color='green'>Updating {garden.data['Pocket Garden Name'] || 'Pocket garden'} · {plotId}</Alert>
          {!eligible && <Alert>This garden is not accepting new updates.{draft.attempt && ' Retry the prior save to check whether it succeeded.'}</Alert>}
          {paused && <Text>This garden is paused. You can record observations, notes, and photos.</Text>}
          {hasPausedWork && (
            <Alert color='yellow'>
              This draft contains work selections from before the garden was paused.
              <Button type='button' variant='subtle' disabled={locked} onClick={() => form.setValues({ activity: [], plants: [] })}>Remove work selections</Button>
            </Alert>
          )}
          {storageError && <Alert color='yellow'>This browser could not store your draft. Make browser storage available and try saving again.</Alert>}
          {(garden.isRefetchError || capabilities.isRefetchError) && <Alert color='yellow'>Unable to refresh the garden or update access. <Button variant='subtle' onClick={() => { if (garden.isRefetchError) garden.refetch(); if (capabilities.isRefetchError) capabilities.refetch(); }}>Retry refresh</Button></Alert>}
          <TextInput type='date' label='When did this happen?' required={!editing || !!draft.baseline.date} max={dateUnchanged ? undefined : today} disabled={locked} {...form.getInputProps('date')} />
          {!quick && !paused && <Checkbox.Group label='What did you do?' {...form.getInputProps('activity')}><Stack gap='xs'>{[...new Set([...capabilities.data.activities, ...draft.activity])].map((activity) => <Checkbox key={activity} label={activity} value={activity} disabled={locked} />)}</Stack></Checkbox.Group>}
          {!quick && !paused && (draft.activity.includes('Planted') || draft.plants.length > 0) && <MaintenancePlants plants={draft.plants} disabled={locked} onChange={(plants) => setFieldValue('plants', plants)} />}
          {!quick && (
            <Checkbox.Group label='What did you see?' value={draft.observations} disabled={locked} onChange={(observations) => setFieldValue('observations', (previous) => selectObservations(previous, observations))}>
              <Stack gap='xs'>{capabilities.data.observations.map((observation) => <Checkbox key={observation} label={observation} value={observation} />)}</Stack>
            </Checkbox.Group>
          )}
          {draft.uploadsPending && <Alert color='yellow'>A previous photo upload was interrupted. Reattach unfinished photos or continue without them.</Alert>}
          <MaintenancePhotos key={draft.submissionId} photos={draft.photos} disabled={locked} onUploadStateChange={setUploadState} onChange={(photos) => setFieldValue('photos', photos)} />
          {quick && <Button variant='subtle' disabled={locked} onClick={() => { setDetailsExpanded(true); navigate(location.pathname, { replace: true }); }}>Add more details</Button>}
          {!quick && <Textarea label='Anything to add?' disabled={locked} {...form.getInputProps('notes')} autosize minRows={3} />}
          {editing && conflicted && <Alert color='yellow'>Your draft has been preserved. <Button type='button' variant='subtle' loading={reloading} onClick={loadLatest}>Load latest update</Button></Alert>}
          {error && <Alert color='red' role='alert'>{error}{draft.attempt && !conflicted && <Text size='sm'>Retry sends the same attempted update. Review garden history if you no longer want to retry.</Text>}</Alert>}
          <Group><Button type='submit' loading={saving} disabled={!canSubmit}>{draft.attempt ? 'Try again' : editing ? 'Save changes' : 'Add this update'}</Button><Button variant='subtle' disabled={saving} onClick={cancel}>Cancel</Button><Button variant='subtle' color='red' disabled={saving || !hasDraftContent} onClick={discard}>Discard local draft</Button></Group>
        </Stack>
      </form>
    </Container>
  );
}
