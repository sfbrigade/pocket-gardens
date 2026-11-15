import { useCallback, useEffect, useRef, useState } from 'react';
import { Alert, Button, Checkbox, Container, Group, Loader, Stack, Text, Textarea, TextInput, Title } from '@mantine/core';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate, useParams, useLocation } from 'react-router';
import Api from '../Api';
import MaintenancePhotos from './MaintenancePhotos';
import MaintenancePlants from './MaintenancePlants';
import { draftKey, maintenanceError, maintenancePayload, newMaintenanceDraft, toggleObservation, draftFromRecord, editMaintenancePayload } from './maintenance-draft';

export default function MaintenanceForm () {
  const { plotId, recordId } = useParams();
  const record = useQuery({ queryKey: ['maintenance-record', recordId], queryFn: ({ signal }) => Api.maintenance.get(recordId, signal).then(({ data }) => data), enabled: !!recordId, retry: false });
  if (recordId && record.isPending) return <Container><Loader aria-label='Loading saved update' /></Container>;
  if (recordId && record.isError) return <Container><Alert color='red'>{record.error.response?.status === 404 ? 'This update no longer exists.' : 'Unable to load the saved update.'}</Alert><Button component={Link} to={`/plots/${encodeURIComponent(plotId)}?tab=updates`}>Back to updates</Button></Container>;
  return <MaintenanceComposer key={`${plotId}:${recordId || 'new'}`} plotId={plotId} recordId={recordId} initialRecord={recordId ? record.data : null} />;
}

function MaintenanceComposer ({ plotId, recordId, initialRecord }) {
  const editing = !!recordId;
  const storageKey = draftKey(plotId, recordId);
  const navigate = useNavigate();
  const location = useLocation();
  const quick = new URLSearchParams(location.search).get('quick') === 'photo';
  const client = useQueryClient();
  const capabilities = useQuery({ queryKey: ['maintenance-capabilities'], queryFn: ({ signal }) => Api.maintenance.capabilities(signal).then(({ data }) => data) });
  const garden = useQuery({ queryKey: ['plot', plotId], queryFn: ({ signal }) => Api.plots.get(plotId, signal).then(({ data }) => data) });
  const [draft, setDraft] = useState(() => {
    try { const value = JSON.parse(window.sessionStorage.getItem(storageKey)); if (value?.submissionId) return value; } catch {}
    return initialRecord ? draftFromRecord(initialRecord) : newMaintenanceDraft('');
  });
  const [photoBusy, setPhotoBusy] = useState(false);
  const [error, setError] = useState('');
  const [conflicted, setConflicted] = useState(false);
  const [deleted, setDeleted] = useState(false);
  const [saved, setSaved] = useState(null);
  const [storageError, setStorageError] = useState(false);
  const submitting = useRef(false);
  const persistDraft = useCallback((value) => {
    try { window.sessionStorage.setItem(storageKey, JSON.stringify(value)); } catch { setStorageError(true); }
  }, [storageKey]);
  const mutation = useMutation({
    mutationFn: ({ payload }) => editing ? Api.maintenance.update(recordId, payload) : Api.maintenance.create(payload),
    onSuccess: ({ data }, { gardenId }) => {
      client.setQueryData(['maintenance-record', data.id], data);
      client.resetQueries({ queryKey: ['maintenance', gardenId], exact: true });
    },
  });
  const saving = mutation.isPending;
  useEffect(() => { if (!editing && !draft.date && capabilities.data) setDraft((value) => ({ ...value, date: capabilities.data.today })); }, [capabilities.data, draft.date, editing]);
  useEffect(() => {
    if (saved) return;
    persistDraft({ ...draft, uploadsPending: photoBusy });
    const warn = (event) => { if (draft.attempt || draft.notes || draft.activity.length || draft.observations.length || draft.photos.length || draft.plants.length || photoBusy) event.preventDefault(); };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [draft, persistDraft, saved, photoBusy]);

  function submit (event) {
    event.preventDefault();
    if (submitting.current || saving || !canSubmit) return;
    if (quick && !draft.photos.length) { setError('Add a photo first, or choose Add more details.'); return; }
    const payload = draft.attempt || (editing ? editMaintenancePayload(draft) : maintenancePayload(draft, plotId));
    if (editing && Object.keys(payload).length === 2) { setError('Make at least one change before saving.'); return; }
    if (editing && !draft.attempt && draft.baseline.photos.some(({ id }) => !payload.photos?.some((photo) => photo.id === id)) && payload.photos && !window.confirm('Permanently erase the removed photos when this edit saves?')) return;
    const attempted = { ...draft, attempt: payload, uploadsPending: false };
    submitting.current = true;
    persistDraft(attempted);
    setDraft(attempted);
    setError('');
    mutation.mutate({ payload, gardenId: garden.data.id }, {
      onSuccess: ({ data }) => {
        try {
          const stored = JSON.parse(window.sessionStorage.getItem(storageKey));
          if (stored?.submissionId === attempted.submissionId) window.sessionStorage.removeItem(storageKey);
        } catch {}
        setSaved(data);
      },
      onError: (failure) => {
        setError(maintenanceError(failure));
        const status = failure.response?.status;
        if (editing && status === 409) setConflicted(true);
        if (status === 404 || status === 410) setDeleted(true);
        if ([409, 422].includes(status)) setDraft((value) => ({ ...value, attempt: null }));
      },
      onSettled: () => { submitting.current = false; },
    });
  }

  function discard () {
    if (saving || !window.confirm(draft.attempt ? 'A previous save might have succeeded. Discard this local draft? This will not delete any saved update; review garden history before starting again.' : 'Discard this unsaved local draft?')) return;
    try { window.sessionStorage.removeItem(storageKey); } catch {}
    setDraft(initialRecord ? draftFromRecord(initialRecord) : newMaintenanceDraft(capabilities.data.today));
    setError(''); setConflicted(false);
  }

  function cancel () {
    if (saving) return;
    if ((draft.notes || draft.activity.length || draft.observations.length || draft.photos.length || draft.plants.length || photoBusy || draft.attempt) && !window.confirm(draft.attempt ? 'The save may have succeeded. Keep this draft and return to garden history?' : 'Leave this update? Your draft will be kept in this tab.')) return;
    navigate(`/plots/${encodeURIComponent(plotId)}?tab=updates`);
  }
  if (capabilities.isPending || garden.isPending) return <Container><Loader aria-label='Loading update form' /></Container>;
  if (capabilities.isError || garden.isError) return <Container><Alert color='red'>Unable to load this garden. <Button onClick={() => { capabilities.refetch(); garden.refetch(); }}>Try again</Button></Alert></Container>;
  if (!capabilities.data.canWrite) return <Container><Alert>Only administrators can record updates here.</Alert><Button component={Link} to={`/plots/${encodeURIComponent(plotId)}?tab=updates`}>Back to garden</Button></Container>;
  if (deleted || (initialRecord?.gardenId && initialRecord.gardenId !== garden.data.id)) return <Container><Alert>This update is no longer available in this garden.</Alert><Button component={Link} to={`/plots/${encodeURIComponent(plotId)}?tab=updates`}>Back to updates</Button></Container>;
  if (saved) return <Container size='sm'><Stack><Title order={2}>{editing ? 'Update corrected' : 'Update saved'}</Title><Text>Saved to this garden’s history.</Text>{saved.cleanupPending && <Alert color='yellow'>The edit is saved. Permanent photo erasure is pending and will be retried.</Alert>}<Text>{saved.activity.join(', ')}</Text><Text>{saved.observations.join(', ')}</Text><Text style={{ whiteSpace: 'pre-wrap' }}>{saved.notes}</Text><Text>{saved.photos?.length || 0} photos attached to this update.</Text>{saved.plants?.map((plant) => <Text key={plant.plantId}>{plant.name}{plant.quantity == null ? '' : ` × ${plant.quantity}`}</Text>)}<Button component={Link} to={`/plots/${encodeURIComponent(plotId)}?tab=updates`}>Back to updates</Button><Button variant='light' onClick={() => { if (editing) navigate(`/plots/${encodeURIComponent(plotId)}/updates/new`); else { setSaved(null); setDraft(newMaintenanceDraft(capabilities.data.today)); } }}>Add another update</Button></Stack></Container>;
  const locked = saving || !!draft.attempt;
  const paused = !editing && garden.data.stage === 'paused';
  const eligible = editing || ['potential', 'preparing', 'active', 'paused'].includes(garden.data.stage);
  const hasPausedWork = paused && (draft.activity.length > 0 || draft.plants.length > 0);
  const canSubmit = !photoBusy && !conflicted && (!!draft.attempt || (eligible && !hasPausedWork));
  // Unchanged imported dates are omitted from PATCH, including legacy future
  // dates. Apply the current date limit when selecting a new value.
  const dateUnchanged = editing && draft.date === draft.baseline.date;
  return (
    <Container size='sm' py='md'>
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
          {storageError && <Alert color='yellow'>This browser could not store your draft. Keep this page open until saving succeeds.</Alert>}
          <TextInput type='date' label='When did this happen?' required={!editing || !!draft.baseline.date} max={dateUnchanged ? undefined : capabilities.data.today} value={draft.date} disabled={locked} onChange={(event) => setDraft({ ...draft, date: event.currentTarget.value })} />
          {!quick && !paused && <Checkbox.Group label='What did you do?' value={draft.activity} onChange={(activity) => setDraft({ ...draft, activity })}><Stack gap='xs'>{[...new Set([...capabilities.data.activities, ...draft.activity])].map((activity) => <Checkbox key={activity} label={activity} value={activity} disabled={locked} />)}</Stack></Checkbox.Group>}
          {!quick && !paused && (draft.activity.includes('Planted') || draft.plants.length > 0) && <MaintenancePlants plants={draft.plants} disabled={locked} onChange={(plants) => setDraft({ ...draft, plants })} />}
          {!quick && <Text fw={500}>What did you see?</Text>}
          {!quick && <Stack gap='xs'>{capabilities.data.observations.map((observation) => <Checkbox key={observation} label={observation} checked={draft.observations.includes(observation)} disabled={locked} onChange={() => setDraft({ ...draft, observations: toggleObservation(draft.observations, observation) })} />)}</Stack>}
          {draft.uploadsPending && <Alert color='yellow'>A previous photo upload was interrupted. Reattach unfinished photos or continue without them.</Alert>}
          <MaintenancePhotos key={draft.submissionId} photos={draft.photos} disabled={locked} onBusyChange={setPhotoBusy} onChange={(photos) => setDraft((value) => ({ ...value, photos: typeof photos === 'function' ? photos(value.photos) : photos }))} />
          {quick && <Button variant='subtle' disabled={locked} onClick={() => navigate(location.pathname, { replace: true })}>Add more details</Button>}
          {!quick && <Textarea label='Anything to add?' value={draft.notes} disabled={locked} onChange={(event) => setDraft({ ...draft, notes: event.currentTarget.value })} autosize minRows={3} />}
          {conflicted && <Alert color='yellow'>Your draft has been preserved. <Button variant='subtle' onClick={async () => { if (!window.confirm('Replace this unsaved draft with the latest saved update?')) return; try { const { data } = await Api.maintenance.get(recordId); setDraft(draftFromRecord(data)); setConflicted(false); setError(''); } catch (failure) { setError(maintenanceError(failure)); if (failure.response?.status === 404) setDeleted(true); } }}>Load latest update</Button></Alert>}
          {error && <Alert color='red' role='alert'>{error}{draft.attempt && <Text size='sm'>Retry sends the same attempted update. Review garden history if you no longer want to retry.</Text>}</Alert>}
          <Group><Button type='submit' loading={saving} disabled={!canSubmit}>{draft.attempt ? 'Try again' : editing ? 'Save changes' : 'Add this update'}</Button><Button variant='subtle' disabled={saving} onClick={cancel}>Cancel</Button><Button variant='subtle' color='red' disabled={saving} onClick={discard}>Discard local draft</Button></Group>
        </Stack>
      </form>
    </Container>
  );
}
