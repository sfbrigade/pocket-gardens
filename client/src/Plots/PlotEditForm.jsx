import { useCallback, useEffect, useId, useState } from 'react';
import { Alert, Button, Container, Fieldset, Group, List, Loader, Select, Stack, Text, Textarea, TextInput, Title } from '@mantine/core';
import { useForm } from '@mantine/form';
import { useMounted } from '@mantine/hooks';
import { modals } from '@mantine/modals';
import { useMutation, useMutationState, useQuery, useQueryClient } from '@tanstack/react-query';
import { useHead } from '@unhead/react';
import { Link, useLocation, useNavigate, useParams } from 'react-router';
import Api from '../Api';
import { useAuthContext } from '../AuthContext';
import DraftRefreshGuard from '../Components/DraftRefreshGuard';
import { authPath } from '../LoginDestination';
import { cacheUpdatedPlot, canAdministerPlots, canContributeToPlots, plotPermissionLabels } from '../plots';
import { permissions } from './plot-form';

const fieldLabels = {
  'Pocket Garden Name': 'Garden title',
  'Location Description': 'Where exactly is it?',
  permissionStatus: 'Permission',
  permissionAdditionalNote: 'Additional permission note',
  staffPermissionNotes: 'Staff-only permission notes',
  gardenCareNote: 'Garden care note',
  environmentalNotes: 'Environmental notes',
};
const fields = Object.keys(fieldLabels);
const publicFields = fields.filter((field) => field !== 'staffPermissionNotes');

function changedFields (values, baseline) {
  return Object.fromEntries(Object.keys(baseline).flatMap((field) => {
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

function publicFieldValues (values) {
  return Object.fromEntries(publicFields.filter((field) => typeof values?.[field] === 'string').map((field) => [field, values[field]]));
}

function parseDraft (snapshot) {
  try {
    const stored = JSON.parse(snapshot);
    return { changes: publicFieldValues(stored?.changes ?? stored), baseline: publicFieldValues(stored?.baseline) };
  } catch {
    return { changes: {}, baseline: {} };
  }
}

export default function PlotEditForm () {
  useHead({ title: 'Edit garden details' });
  const mounted = useMounted();
  const { user, isPending, profileError, refetchProfile } = useAuthContext();
  const { plotId } = useParams();
  const location = useLocation();
  const backPath = `/plots/${encodeURIComponent(plotId)}`;
  const canEdit = !isPending && canContributeToPlots(user);
  const isStaff = canAdministerPlots(user);
  const garden = useQuery({
    // Keep administrator-only data separate from public detail and map caches.
    queryKey: ['plot-editor', canEdit ? user.id : undefined, plotId, isStaff],
    queryFn: ({ signal }) => Api.plots.getForEdit(plotId, signal).then(({ data }) => data),
    enabled: mounted && canEdit,
    gcTime: 0,
    staleTime: Infinity,
    retry: false,
  });

  if (!mounted || isPending || (canEdit && garden.isPending && !garden.isPaused)) {
    return <Container py='md'><Loader aria-label='Loading garden editor' /></Container>;
  }
  if (profileError && !user) {
    return <Container py='md'><Alert color='red'>Unable to check garden editing access. <Button onClick={() => refetchProfile()}>Try again</Button></Alert></Container>;
  }
  if (canEdit && garden.data) {
    const storageKey = `pocket-gardens:plot-edit:v1:${user.id}:${garden.data.id}`;
    return <GardenDetailsDraft key={`${user.id}:${plotId}:${isStaff}`} plot={garden.data} routeId={plotId} storageKey={storageKey} />;
  }

  const message = {
    401: 'Sign in again to edit garden details.',
    403: 'You can edit gardens and notes you submitted. Staff can edit any garden.',
    404: 'Garden not found.',
  }[garden.error?.response?.status];
  return (
    <Container py='md'>
      <Stack>
        <Alert color={canEdit ? 'red' : undefined}>{canEdit ? message || 'Unable to load garden details.' : 'A verified account is required to edit garden details.'}</Alert>
        <Group>
          {!user && <Button component={Link} to={authPath('/login', location)}>Sign in</Button>}
          {canEdit && !message && <Button loading={garden.isFetching} onClick={() => garden.refetch()}>Try again</Button>}
          <Button component={Link} to={backPath} variant='subtle'>Back to garden</Button>
        </Group>
      </Stack>
    </Container>
  );
}

function GardenDetailsDraft ({ plot, routeId, storageKey }) {
  const mutationKey = ['plot-edit', storageKey];
  const saves = useMutationState({
    filters: { mutationKey, exact: true },
    select: ({ mutationId, state }) => ({ id: mutationId, status: state.status, changes: state.variables?.changes }),
  });
  const latestSave = saves.at(-1);
  const [priorSaveId] = useState(() => latestSave?.status === 'pending' ? latestSave.id : null);
  const priorSave = saves.find(({ id }) => id === priorSaveId);
  if (priorSave?.status === 'pending') return <Container py='md'><Loader aria-label='Finishing garden save' /></Container>;

  // A reopened editor may have read the garden before its previous save completed.
  const savedFields = priorSave?.status === 'success' ? priorSave.changes : {};
  return <GardenDetailsFields plot={{ ...plot, ...savedFields }} routeId={routeId} storageKey={storageKey} mutationKey={mutationKey} />;
}

function GardenDetailsFields ({ plot, routeId, storageKey, mutationKey }) {
  const client = useQueryClient();
  const navigate = useNavigate();
  const modalId = useId();
  const backPath = `/plots/${encodeURIComponent(plot.id)}`;
  const [baseline] = useState(() => Object.fromEntries(plot.editableFields.map((field) => [field, plot[field] ?? ''])));
  const [draft] = useState(() => {
    const snapshot = readDraft(storageKey);
    const stored = parseDraft(snapshot);
    const changes = changedFields({ ...baseline, ...stored.changes }, baseline);
    return { snapshot, baseline: stored.baseline, values: { ...baseline, ...changes } };
  });
  const [storageFailed, setStorageFailed] = useState(false);
  const persistDraft = useCallback((values) => {
    const changes = publicFieldValues(changedFields(values, baseline));
    try {
      if (Object.keys(changes).length) {
        const original = Object.fromEntries(Object.keys(changes).map((field) => [field, draft.baseline[field] ?? baseline[field].trim()]));
        window.sessionStorage.setItem(storageKey, JSON.stringify({ changes, baseline: original }));
      } else window.sessionStorage.removeItem(storageKey);
      setStorageFailed(false);
    } catch {
      setStorageFailed(true);
    }
  }, [baseline, draft, storageKey]);
  useEffect(() => {
    // A lost response or another save may have already applied some of the draft.
    if (draft.snapshot !== null && readDraft(storageKey) === draft.snapshot) persistDraft(draft.values);
  }, [draft, persistDraft, storageKey]);
  const form = useForm({
    initialValues: draft.values,
    validate: (values) => baseline['Location Description']?.trim() && !values['Location Description'].trim()
      ? { 'Location Description': 'Describe exactly where the garden is.' }
      : {},
    onValuesChange: persistDraft,
  });
  const mutation = useMutation({
    mutationKey,
    networkMode: 'always',
    mutationFn: ({ changes }) => Api.plots.update(plot.id, changes, Object.fromEntries(Object.keys(changes).map((field) => [field, plot[field] ?? null]))),
    onSuccess: async ({ data }, { changes, snapshot }) => {
      try {
        if (snapshot !== null && readDraft(storageKey) === snapshot) window.sessionStorage.removeItem(storageKey);
      } catch { /* Saving is independent of browser storage. */ }
      const changedPublicFields = Object.keys(publicFieldValues(changes));
      if (changedPublicFields.length) await cacheUpdatedPlot(client, data, changedPublicFields, routeId);
      client.invalidateQueries({ queryKey: ['plot-edit-access', plot.id] });
    },
  });
  useEffect(() => () => modals.close(modalId), [modalId]);
  const saving = mutation.isPending;
  const changed = Object.keys(changedFields(form.values, baseline));
  const dirty = changed.length > 0;
  const conflicts = changed.filter((field) => Object.hasOwn(draft.baseline, field) && draft.baseline[field] !== baseline[field].trim());
  const status = mutation.error?.response?.status;
  const unavailable = status === 401 || status === 403 || status === 404;
  const stale = status === 409;

  function save (values) {
    if (client.isMutating({ mutationKey, exact: true }) || unavailable || stale) return;
    const changes = changedFields(values, baseline);
    if (!Object.keys(changes).length) return;
    mutation.mutate({ changes, snapshot: readDraft(storageKey) }, {
      onSuccess: () => navigate(backPath, { replace: true, state: { edited: true } }),
      onError: (error) => {
        if (error.response?.status === 422) {
          const errors = error.response.data?.errors;
          if (Array.isArray(errors)) {
            form.setErrors(Object.fromEntries(errors.filter((issue) => fields.includes(issue?.path)).map(({ path, message }) => [path, message])));
          }
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
    409: 'The garden details changed while you were editing.',
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
          {stale && <Alert>Reopen the editor to compare your public draft with the latest values.{changed.includes('staffPermissionNotes') && ' Unsaved staff notes stay in this form until you leave.'}</Alert>}
          {conflicts.length > 0 && (
            <Alert color='yellow' title='Saved details changed' role='alert'>
              Review these saved values before replacing them with your draft.
              <List size='sm'>
                {conflicts.map((field) => (
                  <List.Item key={field}><strong>{fieldLabels[field]}</strong> — {(field === 'permissionStatus' ? plotPermissionLabels[baseline[field]] : baseline[field].trim()) || '(blank)'}</List.Item>
                ))}
              </List>
            </Alert>
          )}
          <Fieldset variant='unstyled' disabled={saving || unavailable}>
            <Stack>
              {Object.hasOwn(baseline, 'Pocket Garden Name') && <TextInput label={fieldLabels['Pocket Garden Name']} {...form.getInputProps('Pocket Garden Name')} />}
              {Object.hasOwn(baseline, 'Location Description') && <Textarea label={fieldLabels['Location Description']} autosize minRows={2} {...form.getInputProps('Location Description')} />}
              {Object.hasOwn(baseline, 'permissionStatus') && <Select label={fieldLabels.permissionStatus} data={permissions} allowDeselect={false} {...form.getInputProps('permissionStatus')} value={form.values.permissionStatus || null} />}
              {['permissionAdditionalNote', 'staffPermissionNotes', 'gardenCareNote', 'environmentalNotes'].filter((field) => Object.hasOwn(baseline, field)).map((field) => (
                <Textarea key={field} label={fieldLabels[field]} description={field === 'staffPermissionNotes' ? 'Visible to verified administrators. Unsaved text stays in this form.' : 'Visible on the public garden page.'} autosize minRows={2} {...form.getInputProps(field)} />
              ))}
            </Stack>
          </Fieldset>
          <Group>
            <Button type='submit' loading={saving} disabled={!dirty || unavailable || stale}>Save garden details</Button>
            {stale
              ? <Button component={Link} to={backPath} replace variant='subtle'>Return to garden and keep public draft</Button>
              : <Button type='button' variant='subtle' disabled={saving} onClick={cancel}>{unavailable ? 'Back to garden' : 'Cancel'}</Button>}
          </Group>
        </Stack>
      </form>
    </Container>
  );
}
