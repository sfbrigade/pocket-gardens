import { useCallback, useEffect, useId, useState } from 'react';
import { Alert, Button, Container, Fieldset, Group, Loader, Select, Stack, Text, Textarea, TextInput, Title } from '@mantine/core';
import { useForm } from '@mantine/form';
import { useMounted } from '@mantine/hooks';
import { modals } from '@mantine/modals';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useHead } from '@unhead/react';
import { Link, useLocation, useNavigate, useParams } from 'react-router';
import Api from '../Api';
import { useAuthContext } from '../AuthContext';
import DraftRefreshGuard from '../Components/DraftRefreshGuard';
import { authPath } from '../LoginDestination';
import { cacheUpdatedPlot, canEditPlot, plotQueryOptions } from '../plots';
import { permissions } from './plot-form';

const fields = ['Pocket Garden Name', 'Location Description', 'permissionStatus', 'environmentalNotes'];

function changedFields (values, baseline) {
  return Object.fromEntries(fields.flatMap((field) => {
    const value = values[field].trim();
    return value === baseline[field].trim() ? [] : [[field, value]];
  }));
}

function readDraft (key) {
  try {
    return window.sessionStorage.getItem(key);
  } catch {
    return null;
  }
}

function storedValues (snapshot) {
  try {
    const stored = JSON.parse(snapshot);
    return Object.fromEntries(fields.filter((field) => typeof stored?.[field] === 'string').map((field) => [field, stored[field]]));
  } catch {
    return {};
  }
}

export default function PlotEditForm () {
  useHead({ title: 'Edit garden details' });
  const mounted = useMounted();
  const { user, isPending, profileError, refetchProfile } = useAuthContext();
  const { plotId } = useParams();
  const location = useLocation();
  const backPath = `/plots/${encodeURIComponent(plotId)}`;
  const canEdit = !isPending && canEditPlot(user);
  const garden = useQuery({
    ...plotQueryOptions(plotId),
    enabled: mounted && canEdit,
    staleTime: 0,
    retry: false,
  });

  if (!mounted || isPending || (canEdit && !garden.isFetchedAfterMount && !garden.isPaused)) return <Container py='md'><Loader aria-label='Loading garden editor' /></Container>;
  if (profileError && !user) {
    return <Container py='md'><Alert color='red'>Unable to check garden editing access. <Button onClick={() => refetchProfile()}>Try again</Button></Alert></Container>;
  }
  if (!canEdit) {
    return (
      <Container py='md'>
        <Stack>
          <Alert>Only verified administrators can edit garden details.</Alert>
          <Group>
            {!user && <Button component={Link} to={authPath('/login', location)}>Sign in</Button>}
            <Button component={Link} to={backPath} variant='subtle'>Back to garden</Button>
          </Group>
        </Stack>
      </Container>
    );
  }
  if (!garden.data || !garden.isFetchedAfterMount || garden.isError) {
    const missing = garden.error?.response?.status === 404;
    return (
      <Container py='md'>
        <Stack>
          <Alert color='red'>{missing ? 'Garden not found.' : 'Unable to load garden details.'}</Alert>
          <Group>
            {!missing && <Button loading={garden.isFetching} onClick={() => garden.refetch()}>Try again</Button>}
            <Button component={Link} to={backPath} variant='subtle'>Back to garden</Button>
          </Group>
        </Stack>
      </Container>
    );
  }
  const storageKey = `pocket-gardens:plot-edit:v1:${user.id}:${garden.data.id}`;
  return <GardenDetailsFields key={storageKey} plot={garden.data} routeId={plotId} storageKey={storageKey} />;
}

function GardenDetailsFields ({ plot, routeId, storageKey }) {
  const client = useQueryClient();
  const navigate = useNavigate();
  const modalId = useId();
  const backPath = `/plots/${encodeURIComponent(plot.id)}`;
  const [baseline] = useState(() => Object.fromEntries(fields.map((field) => [field, plot[field] ?? ''])));
  const [draft] = useState(() => {
    const snapshot = readDraft(storageKey);
    const changes = changedFields({ ...baseline, ...storedValues(snapshot) }, baseline);
    return { snapshot, values: { ...baseline, ...changes } };
  });
  const [storageFailed, setStorageFailed] = useState(false);
  const persistDraft = useCallback((values) => {
    const changes = changedFields(values, baseline);
    try {
      if (Object.keys(changes).length) window.sessionStorage.setItem(storageKey, JSON.stringify(changes));
      else window.sessionStorage.removeItem(storageKey);
      setStorageFailed(false);
    } catch {
      setStorageFailed(true);
    }
  }, [baseline, storageKey]);
  useEffect(() => {
    // A lost response or another save may have already applied some of the draft.
    if (draft.snapshot !== null && readDraft(storageKey) === draft.snapshot) persistDraft(draft.values);
  }, [draft, persistDraft, storageKey]);
  const form = useForm({
    initialValues: draft.values,
    validate: {
      'Location Description': (value) => !value.trim() && baseline['Location Description'].trim() ? 'Describe exactly where the garden is.' : null,
    },
    onValuesChange: persistDraft,
  });
  const mutationKey = ['plot-edit', storageKey];
  const mutation = useMutation({
    mutationKey,
    mutationFn: ({ changes }) => Api.plots.update(plot.id, changes),
    onSuccess: async ({ data }, { changes, snapshot }) => {
      try {
        if (snapshot !== null && readDraft(storageKey) === snapshot) window.sessionStorage.removeItem(storageKey);
      } catch { /* Saving is independent of browser storage. */ }
      await cacheUpdatedPlot(client, data, Object.keys(changes), routeId);
    },
  });
  useEffect(() => () => modals.close(modalId), [modalId]);
  const dirty = Object.keys(changedFields(form.values, baseline)).length > 0;
  const status = mutation.error?.response?.status;
  const unavailable = status === 401 || status === 403 || status === 404;

  function save (values) {
    if (client.isMutating({ mutationKey, exact: true }) || unavailable) return;
    const changes = changedFields(values, baseline);
    if (!Object.keys(changes).length) return;
    mutation.mutate({ changes, snapshot: readDraft(storageKey) }, {
      onSuccess: () => navigate(backPath, { replace: true, state: { edited: true } }),
      onError: (error) => {
        if (error.response?.status === 422) {
          form.setErrors(Object.fromEntries(error.response.data.errors.filter(({ path }) => fields.includes(path)).map(({ path, message }) => [path, message])));
        }
      },
    });
  }

  function cancel () {
    if (!dirty || unavailable) { navigate(backPath, { replace: true }); return; }
    modals.openConfirmModal({
      modalId,
      title: 'Discard your changes to this garden?',
      labels: { confirm: 'Discard changes', cancel: 'Keep editing' },
      onConfirm: () => {
        form.setValues(baseline);
        navigate(backPath, { replace: true });
      },
    });
  }

  const errorMessage = {
    401: 'Sign in again to continue editing.',
    403: 'You no longer have access to edit this garden.',
    404: 'This garden is no longer available.',
    422: 'Check the garden details and try again.',
  }[status] || 'Unable to save garden details. Try again.';

  return (
    <Container size='sm' py='md'>
      {dirty && !mutation.isSuccess && <DraftRefreshGuard />}
      <form onSubmit={form.onSubmit(save)}>
        <Stack>
          <Title order={1}>Edit garden details</Title>
          <Text>{plot['Pocket Garden Name'] || 'Pocket garden'} · {plot.id}</Text>
          {storageFailed && <Alert color='yellow' role='status'>This browser could not store your changes for later.</Alert>}
          {mutation.isError && <Alert color='red' role='alert'>{errorMessage}</Alert>}
          <Fieldset variant='unstyled' disabled={mutation.isPending || unavailable}>
            <Stack>
              <TextInput label='Garden title' {...form.getInputProps('Pocket Garden Name')} />
              <Textarea label='Where exactly is it?' autosize minRows={2} {...form.getInputProps('Location Description')} />
              <Select label='Permission' data={permissions} allowDeselect={false} {...form.getInputProps('permissionStatus')} value={form.values.permissionStatus || null} />
              <Textarea label='Environmental notes' description='Visible to anyone viewing this garden.' autosize minRows={2} {...form.getInputProps('environmentalNotes')} />
            </Stack>
          </Fieldset>
          <Group>
            <Button type='submit' loading={mutation.isPending} disabled={!dirty || unavailable}>Save garden details</Button>
            <Button type='button' variant='subtle' disabled={mutation.isPending} onClick={cancel}>{unavailable ? 'Back to garden' : 'Cancel'}</Button>
          </Group>
        </Stack>
      </form>
    </Container>
  );
}
