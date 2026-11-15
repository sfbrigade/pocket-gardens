import { useCallback, useEffect, useRef, useState } from 'react';
import { Alert, Button, Checkbox, Container, Group, Loader, Stack, Text, Textarea, TextInput, Title } from '@mantine/core';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate, useParams, useLocation } from 'react-router';
import Api from '../Api';
import MaintenancePhotos from './MaintenancePhotos';
import MaintenancePlants from './MaintenancePlants';
import { draftKey, maintenanceError, maintenancePayload, newMaintenanceDraft, toggleObservation } from './maintenance-draft';

export default function MaintenanceForm () {
  const { plotId } = useParams();
  return <MaintenanceComposer key={plotId} plotId={plotId} />;
}

function MaintenanceComposer ({ plotId }) {
  const storageKey = draftKey(plotId);
  const navigate = useNavigate();
  const location = useLocation();
  const quick = new URLSearchParams(location.search).get('quick') === 'photo';
  const client = useQueryClient();
  const capabilities = useQuery({ queryKey: ['maintenance-capabilities'], queryFn: ({ signal }) => Api.maintenance.capabilities(signal).then(({ data }) => data) });
  const garden = useQuery({ queryKey: ['plot', plotId], queryFn: ({ signal }) => Api.plots.get(plotId, signal).then(({ data }) => data) });
  const [draft, setDraft] = useState(() => {
    try { const value = JSON.parse(window.sessionStorage.getItem(storageKey)); if (value?.submissionId) return value; } catch {}
    return newMaintenanceDraft('');
  });
  const [photoBusy, setPhotoBusy] = useState(false);
  const [error, setError] = useState('');
  const [saved, setSaved] = useState(null);
  const [storageError, setStorageError] = useState(false);
  const submitting = useRef(false);
  const persistDraft = useCallback((value) => {
    try { window.sessionStorage.setItem(storageKey, JSON.stringify(value)); } catch { setStorageError(true); }
  }, [storageKey]);
  const mutation = useMutation({
    mutationFn: ({ payload }) => Api.maintenance.create(payload),
    onSuccess: (_response, { gardenId }) => {
      client.resetQueries({ queryKey: ['maintenance', gardenId], exact: true });
    },
  });
  const saving = mutation.isPending;
  useEffect(() => { if (!draft.date && capabilities.data) setDraft((value) => ({ ...value, date: capabilities.data.today })); }, [capabilities.data, draft.date]);
  useEffect(() => {
    if (saved) return;
    persistDraft({ ...draft, uploadsPending: photoBusy });
    const warn = (event) => { if (draft.attempt || draft.notes || draft.activity.length || draft.observations.length) event.preventDefault(); };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [draft, persistDraft, saved, photoBusy]);

  function submit (event) {
    event.preventDefault();
    if (submitting.current || saving || !canSubmit) return;
    if (quick && !draft.photos.length) { setError('Add a photo first, or choose Add more details.'); return; }
    const payload = draft.attempt || maintenancePayload(draft, plotId);
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
        if (failure.response?.status === 422) setDraft((value) => ({ ...value, attempt: null }));
      },
      onSettled: () => { submitting.current = false; },
    });
  }

  function cancel () {
    if (saving) return;
    if ((draft.notes || draft.activity.length || draft.observations.length || draft.attempt) && !window.confirm(draft.attempt ? 'The save may have succeeded. Keep this draft and return to garden history?' : 'Leave this update? Your draft will be kept in this tab.')) return;
    navigate(`/plots/${encodeURIComponent(plotId)}?tab=updates`);
  }
  if (capabilities.isPending || garden.isPending) return <Container><Loader aria-label='Loading update form' /></Container>;
  if (capabilities.isError || garden.isError) return <Container><Alert color='red'>Unable to load this garden. <Button onClick={() => { capabilities.refetch(); garden.refetch(); }}>Try again</Button></Alert></Container>;
  if (!capabilities.data.canWrite) return <Container><Alert>Only administrators can record updates here.</Alert><Button component={Link} to={`/plots/${encodeURIComponent(plotId)}?tab=updates`}>Back to garden</Button></Container>;
  if (saved) return <Container size='sm'><Stack><Title order={2}>Update saved</Title><Text>Saved to this garden’s history.</Text><Text>{saved.activity.join(', ')}</Text><Text>{saved.observations.join(', ')}</Text><Text style={{ whiteSpace: 'pre-wrap' }}>{saved.notes}</Text><Text>{saved.photos?.length || 0} photos attached to this update.</Text>{saved.plants?.map((plant) => <Text key={plant.plantId}>{plant.name}{plant.quantity == null ? '' : ` × ${plant.quantity}`}</Text>)}<Button component={Link} to={`/plots/${encodeURIComponent(plotId)}?tab=updates`}>Back to updates</Button><Button variant='light' onClick={() => { setSaved(null); setDraft(newMaintenanceDraft(capabilities.data.today)); }}>Add another update</Button></Stack></Container>;
  const locked = saving || !!draft.attempt;
  const paused = garden.data.stage === 'paused';
  const eligible = ['potential', 'preparing', 'active', 'paused'].includes(garden.data.stage);
  const hasPausedWork = paused && draft.activity.length > 0;
  const canSubmit = !photoBusy && (!!draft.attempt || (eligible && !hasPausedWork));
  return (
    <Container size='sm' py='md'>
      <form onSubmit={submit}>
        <Stack>
          <Title order={2}>Add an update</Title>
          <Alert color='green'>Updating {garden.data['Pocket Garden Name'] || 'Pocket garden'} · {plotId}</Alert>
          {!eligible && <Alert>This garden is not accepting new updates.{draft.attempt && ' Retry the prior save to check whether it succeeded.'}</Alert>}
          {paused && <Text>This garden is paused. You can record observations, notes, and photos.</Text>}
          {hasPausedWork && (
            <Alert color='yellow'>
              This draft contains work selections from before the garden was paused.
              <Button type='button' variant='subtle' disabled={locked} onClick={() => setDraft((value) => ({ ...value, activity: [] }))}>Remove work selections</Button>
            </Alert>
          )}
          {storageError && <Alert color='yellow'>This browser could not store your draft. Keep this page open until saving succeeds.</Alert>}
          <TextInput type='date' label='When did this happen?' required max={capabilities.data.today} value={draft.date} disabled={locked} onChange={(event) => setDraft({ ...draft, date: event.currentTarget.value })} />
          {!quick && !paused && <Checkbox.Group label='What did you do?' value={draft.activity} onChange={(activity) => setDraft({ ...draft, activity })}><Stack gap='xs'>{capabilities.data.activities.map((activity) => <Checkbox key={activity} label={activity} value={activity} disabled={locked} />)}</Stack></Checkbox.Group>}
          {!quick && !paused && (draft.activity.includes('Planted') || draft.plants.length > 0) && <MaintenancePlants plants={draft.plants} disabled={locked} onChange={(plants) => setDraft({ ...draft, plants })} />}
          {!quick && <Text fw={500}>What did you see?</Text>}
          {!quick && <Stack gap='xs'>{capabilities.data.observations.map((observation) => <Checkbox key={observation} label={observation} checked={draft.observations.includes(observation)} disabled={locked} onChange={() => setDraft({ ...draft, observations: toggleObservation(draft.observations, observation) })} />)}</Stack>}
          {draft.uploadsPending && <Alert color='yellow'>A previous photo upload was interrupted. Reattach unfinished photos or continue without them.</Alert>}
          <MaintenancePhotos photos={draft.photos} disabled={locked} onBusyChange={setPhotoBusy} onChange={(photos) => setDraft((value) => ({ ...value, photos: typeof photos === 'function' ? photos(value.photos) : photos }))} />
          {quick && <Button variant='subtle' disabled={locked} onClick={() => navigate(location.pathname, { replace: true })}>Add more details</Button>}
          {!quick && <Textarea label='Anything to add?' value={draft.notes} disabled={locked} onChange={(event) => setDraft({ ...draft, notes: event.currentTarget.value })} autosize minRows={3} />}
          {error && <Alert color='red' role='alert'>{error}{draft.attempt && <Text size='sm'>Retry sends the same attempted update. Review garden history if you no longer want to retry.</Text>}</Alert>}
          <Group><Button type='submit' loading={saving} disabled={!canSubmit}>{draft.attempt ? 'Try again' : 'Add this update'}</Button><Button variant='subtle' disabled={saving} onClick={cancel}>Cancel</Button></Group>
        </Stack>
      </form>
    </Container>
  );
}
