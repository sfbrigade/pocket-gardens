import { useCallback, useEffect, useRef, useState } from 'react';
import { useBeforeUnload, useLocation, useNavigate } from 'react-router';
import { Alert, Anchor, Box, Button, Container, Fieldset, Group, Loader, Modal, NumberInput, Paper, Select, SimpleGrid, Stack, Text, Textarea, TextInput, Title, useMantineTheme } from '@mantine/core';
import { useDisclosure, useMediaQuery, useMounted, useSessionStorage } from '@mantine/hooks';
import { useForm } from '@mantine/form';
import { modals } from '@mantine/modals';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useHead } from '@unhead/react';
import { v4 as uuid } from 'uuid';

import Api from '../Api';
import { isMapPosition } from '../map-location';
import GardenMap from '../Components/GardenMap';
import PhotoInput from '../Components/PhotoInput';
import PlantPicker from './PlantPicker';
import usePlotSuggestions from './usePlotSuggestions';
import { matchingPlotSubmission, preparePlotSubmission } from './plot-submission';
import { beds, createPlotDraft, hasDraftContent, maxPlantQuantity, permissions, plotDraftErrors, plotFormErrors, soils, stages, sunLevels } from './plot-form';

function RefreshGuard () {
  useBeforeUnload(useCallback((event) => { event.preventDefault(); event.returnValue = true; }, []));
  return null;
}

export default function PlotForm () {
  useHead({ title: 'Create a garden' });
  const mounted = useMounted();
  const theme = useMantineTheme();
  const desktop = useMediaQuery(`(min-width: ${theme.breakpoints.md})`, false);
  const navigate = useNavigate();
  const location = useLocation();
  const queryClient = useQueryClient();
  const [initial] = useState(createPlotDraft);
  const [saved, setSaved, removeSaved] = useSessionStorage({ key: 'pocket-gardens:plot-draft:v1', defaultValue: null });
  const hydrated = useRef(false);
  const [restored, setRestored] = useState(false);
  const [pendingPosition, setPendingPosition] = useState(null);
  const handledLocation = useRef(null);
  const [photoState, setPhotoState] = useState('idle');
  const [mapOpened, { open: openMap, close: closeMap }] = useDisclosure();
  const capability = useQuery({ queryKey: ['plots', 'capabilities'], queryFn: ({ signal }) => Api.plots.capabilities(signal).then(({ data }) => data), enabled: mounted });
  const form = useForm({
    name: 'plot-submission',
    mode: 'controlled',
    initialValues: initial,
    onValuesChange: (values) => { if (hydrated.current) setSaved(values); },
    validate: plotDraftErrors,
  });
  useEffect(() => {
    if (!mounted || hydrated.current) return;
    hydrated.current = true;
    if (saved && typeof saved === 'object' && typeof saved.submissionId === 'string' && Array.isArray(saved.plants)) {
      const values = { ...initial, ...saved, nameEdited: saved.nameEdited ?? !!saved.name, addressEdited: saved.addressEdited ?? !!saved.address };
      form.setValues(values);
      setRestored(hasDraftContent(values));
    }
  }, [mounted, saved]);

  function clearIncomingPosition () {
    navigate(location.pathname, { replace: true, state: { ...location.state, mapPosition: undefined } });
    setPendingPosition(null);
  }

  useEffect(() => {
    const incoming = location.state?.mapPosition;
    if (!mounted || !hydrated.current || !capability.data?.canCreatePlot || !isMapPosition(incoming) || handledLocation.current === location.key) return;
    handledLocation.current = location.key;
    const draft = form.getValues();
    const samePosition = draft.position?.latitude === incoming.latitude && draft.position?.longitude === incoming.longitude;
    if (hasDraftContent(draft) && !samePosition) {
      // Leave the route state intact until a choice is made, including across refresh.
      setPendingPosition(incoming);
    } else {
      if (!samePosition) form.setFieldValue('position', incoming);
      clearIncomingPosition();
    }
  }, [mounted, capability.data?.canCreatePlot, location.key]);

  const mutation = useMutation({
    mutationFn: Api.plots.create,
    onSuccess: ({ data }) => {
      queryClient.setQueryData(['plot', data.id], data);
      queryClient.invalidateQueries({ queryKey: ['plots'] });
    },
  });
  const previousAttempt = matchingPlotSubmission(form.values);
  const suggestions = usePlotSuggestions(form.values, mutation.isPending || !!previousAttempt);
  const attemptedPayload = mutation.isPending ? mutation.variables : previousAttempt?.payload;
  const values = {
    ...form.values,
    ...(attemptedPayload
      ? { address: attemptedPayload['Street Address'] ?? '', name: attemptedPayload['Pocket Garden Name'] ?? '' }
      : suggestions.identification),
  };
  const needsPhoto = values.photoWasSelected && !values.photo && photoState === 'idle';
  const blockedPhoto = photoState === 'uploading' || photoState === 'error' || needsPhoto;
  const dirty = hasDraftContent(values) && !mutation.isSuccess;

  function discard () {
    const finish = () => { hydrated.current = false; removeSaved(); navigate('/'); };
    if (!dirty) finish();
    else modals.openConfirmModal({ title: 'Discard this garden draft?', children: <Text>Your unfinished garden will be removed.</Text>, labels: { confirm: 'Discard draft', cancel: 'Keep editing' }, onConfirm: finish });
  }

  function addPlant (plant) {
    const existing = values.plants.findIndex((entry) => plant.plantId ? entry.plantId === plant.plantId : entry.newPlant && JSON.stringify(entry.newPlant) === JSON.stringify(plant.newPlant));
    if (existing >= 0) { form.getInputNode(`plants.${existing}.quantity`)?.focus(); return; }
    form.insertListItem('plants', { ...plant, key: uuid(), quantity: '', notes: '' });
  }

  const photoSubmissionId = values.submissionId;
  function photoChanged (state) {
    if (form.getValues().submissionId !== photoSubmissionId) return;
    setPhotoState(state);
    form.setFieldValue('photoWasSelected', state !== 'idle');
  }

  const map = <GardenMap mode='pick' disabled={mutation.isPending || !!pendingPosition} position={values.position} onPositionChange={(position) => { if (!mutation.isPending && !pendingPosition) form.setFieldValue('position', position); }} />;
  const stageLabel = stages.find(({ value }) => value === values.stage)?.label;
  if (capability.isPending) return <Container py='xl'><Loader aria-label='Checking garden creation access' /></Container>;
  if (capability.isError) return <Container py='xl'><Alert color='red' title='Unable to check access'><Button variant='subtle' onClick={() => capability.refetch()}>Try again</Button></Alert></Container>;
  if (!capability.data.canCreatePlot) return <Container py='xl'><Alert title='A staff account is needed'>Please sign in with a staff account to create a garden.</Alert><Group mt='md'><Button onClick={() => navigate('/login', { state: { from: '/plots/new' } })}>Sign in</Button><Button variant='subtle' onClick={() => navigate('/')}>Back to map</Button></Group></Container>;

  return (
    <Container size='xl' py='md'>
      {dirty && <RefreshGuard />}
      <Group justify='space-between' mb='lg'><div><Title order={1}>Create a new garden</Title><Text c='dimmed'>Add a garden to Pocket Gardens. You can fill the rest in later.</Text></div><Button variant='subtle' onClick={() => navigate('/')}>Back to map</Button></Group>
      {pendingPosition && (
        <Alert color='yellow' title='You have an unfinished garden' role='alert' mb='lg'>
          <Text>The map location ({pendingPosition.latitude.toFixed(5)}, {pendingPosition.longitude.toFixed(5)}) is for a different garden. Keep your existing draft, or discard it and start a new garden at this pin.</Text>
          <Group mt='sm'>
            <Button onClick={clearIncomingPosition}>Keep existing draft</Button>
            <Button
              color='red' variant='outline' onClick={() => {
                form.setValues({ ...createPlotDraft(), position: pendingPosition });
                form.clearErrors();
                setPhotoState('idle');
                setRestored(false);
                clearIncomingPosition();
              }}
            >Discard draft and start here
            </Button>
          </Group>
        </Alert>
      )}
      <SimpleGrid cols={{ base: 1, md: 2 }} spacing='xl'>
        <form onSubmit={form.onSubmit((draft) => {
          if (blockedPhoto || pendingPosition) return;
          const attempt = preparePlotSubmission(draft, suggestions.result);
          form.setFieldValue('submissionAttempt', attempt);
          // Per-call callbacks belong to this mounted form. A save that outlives
          // navigation still updates the cache without clearing a newer draft.
          mutation.mutate(attempt.payload, {
            onSuccess: ({ data }) => {
              hydrated.current = false;
              removeSaved();
              form.resetDirty();
              navigate(`/plots/${data.id}`, { replace: true, state: { created: true } });
            },
            onError: (errors) => form.setErrors(plotFormErrors(errors)),
          });
        })}
        >
          <Fieldset disabled={mutation.isPending || !!pendingPosition} variant='unstyled'>
            <Stack gap='lg'>
              {restored && <Alert color='green' title='Draft restored'>Your unfinished garden is ready to continue.</Alert>}
              {form.errors._form && <Alert color='red' role='alert'>{form.errors._form}{mutation.error?.plotId && <Button variant='subtle' onClick={() => navigate(`/plots/${mutation.error.plotId}`)}>View saved garden</Button>}</Alert>}
              <Fieldset legend='1 · Garden stage'><Select label='What stage is this garden in?' data={stages} allowDeselect={false} {...form.getInputProps('stage')} /><Text size='sm' c='dimmed' mt='xs'>Potential sites are being considered. Preparing gardens have planned plants. Active gardens are already established.</Text></Fieldset>
              <Fieldset legend='2 · Location and identification'>
                <Stack>
                  <Button onClick={openMap} variant='light'>Choose or adjust the map location</Button>
                  {values.position ? <Paper withBorder p='sm'><Text fw={600}>Location set</Text><Text size='sm'>{values.position.latitude.toFixed(5)}, {values.position.longitude.toFixed(5)}{values.position.accuracy != null && ` · ±${Math.round(values.position.accuracy)} m`}</Text></Paper> : <Text c='dimmed'>A map pin is required. Use your location or tap the map.</Text>}
                  {form.errors.position && <Text c='red' role='alert'>{form.errors.position}</Text>}
                  <TextInput label='Address or cross street' description={previousAttempt && !values.addressEdited ? 'Retained from your last save attempt. You can edit it.' : suggestions.addressNote} {...form.getInputProps('address')} value={values.address} onChange={(event) => { form.setFieldValue('addressEdited', true); form.setFieldValue('address', event.currentTarget.value); }} />
                  <Text size='xs' c='dimmed'>Address suggestions use Photon and <Anchor href='https://www.openstreetmap.org/copyright' target='_blank' rel='noopener'>OpenStreetMap data</Anchor>. Confirm the address before saving.</Text>
                  <Textarea label='Where exactly is it?' description='Street side, plot order, or a fixed landmark, such as the second tree well north of the blue gate.' required autosize minRows={2} {...form.getInputProps('locator')} />
                  <TextInput label='Garden title' description={values.nameEdited ? 'Custom title. Other changes will keep it.' : 'Suggested from the address and exact location. You can edit it.'} {...form.getInputProps('name')} value={values.name} onChange={(event) => { form.setFieldValue('nameEdited', true); form.setFieldValue('name', event.currentTarget.value); }} />
                  {values.nameEdited && suggestions.title && <Button variant='subtle' size='compact-sm' onClick={() => form.setFieldValue('nameEdited', false)}>Reset to suggested title</Button>}
                  <PhotoInput key={values.submissionId} label='Reference photo' description='Optional. A photo that helps somebody recognise this garden.' disabled={mutation.isPending || !!pendingPosition} {...form.getInputProps('photo')} onChange={(filename) => { if (form.getValues().submissionId === photoSubmissionId) form.setFieldValue('photo', filename); }} onUploadStateChange={photoChanged} />
                  {needsPhoto && <Alert color='yellow' title='Reattach your photo'>Your other fields are restored. Choose the photo again or continue without it.<Button variant='subtle' onClick={() => form.setFieldValue('photoWasSelected', false)}>Continue without photo</Button></Alert>}
                </Stack>
              </Fieldset>
              <Fieldset legend='3 · Permission and care'>
                <Stack><Select label='Permission' data={permissions} allowDeselect={false} {...form.getInputProps('permissionStatus')} />
                  {values.stage !== 'potential' && !['confirmed', 'not_required'].includes(values.permissionStatus) && <Alert color='yellow'>Permission has not been confirmed. You can still record this garden’s current stage.</Alert>}
                  <Text c='dimmed' size='sm'>Carers can be assigned by staff later.</Text>
                  {values.stage === 'active' && <TextInput type='date' label='First planted' description='Optional. An approximate date is fine.' {...form.getInputProps('firstPlanted')} />}
                </Stack>
              </Fieldset>
              <Fieldset legend='4 · Growing conditions'>
                <Stack>
                  <Select label='Bed type' clearable data={beds} value={values.bedType || null} onChange={(value) => form.setFieldValue('bedType', value || '')} />
                  <NumberInput label='Approximate area (sq ft)' min={0} {...form.getInputProps('area')} />
                  <Select label='Sun' clearable data={sunLevels} value={values.sunExposure || null} onChange={(value) => form.setFieldValue('sunExposure', value || '')} />
                  <Select label='Soil' clearable data={soils} value={values.soilType || null} onChange={(value) => form.setFieldValue('soilType', value || '')} />
                  <Textarea label='Environmental notes' autosize minRows={2} {...form.getInputProps('environmentalNotes')} />
                </Stack>
              </Fieldset>
              {values.stage !== 'potential' && (
                <Fieldset legend={values.stage === 'active' ? '5 · Plants growing here' : '5 · Planned plants'}>
                  <Stack>
                    <Text size='sm' c='dimmed'>Optional. Select a directory plant, or explicitly add a new one after searching.</Text>
                    <PlantPicker onSelect={addPlant} disabled={mutation.isPending} />
                    {typeof form.errors.plants === 'string' && <Alert color='red'>{form.errors.plants}</Alert>}
                    {values.plants.map((plant, index) => (
                      <Paper key={plant.key} withBorder p='sm'>
                        <Stack gap='xs'>
                          <Group justify='space-between'><Text fw={600}>{plant.label}{plant.newPlant && ' · new directory entry'}</Text><Button variant='subtle' color='red' size='compact-sm' onClick={() => form.removeListItem('plants', index)}>Remove plant</Button></Group>
                          <NumberInput label={`Quantity for ${plant.label}`} min={0} max={maxPlantQuantity} allowDecimal={false} {...form.getInputProps(`plants.${index}.quantity`)} />
                          <TextInput label={`Notes for ${plant.label}`} {...form.getInputProps(`plants.${index}.notes`)} />
                        </Stack>
                      </Paper>
                    ))}
                  </Stack>
                </Fieldset>
              )}
              <Fieldset legend='Review'>
                <Stack gap='xs'>
                  <Text fw={600}>{values.name || values.address || 'Garden ID assigned on save'}</Text>
                  <Text>Stage: {stageLabel}</Text><Text>Look for: {values.locator || 'Required'}</Text>
                  <Text>Permission: {permissions.find(({ value }) => value === values.permissionStatus)?.label}</Text>
                  {values.stage !== 'potential' && <Text>Plants: {values.plants.map(({ label }) => label).join(', ') || 'Not recorded'}</Text>}
                </Stack>
              </Fieldset>
              <Button type='submit' color='green' size='lg' loading={mutation.isPending} disabled={blockedPhoto}>Create garden</Button>
              {photoState === 'uploading' && <Text role='status'>Wait for the photo to finish uploading.</Text>}
              {photoState === 'error' && <Text c='red'>Retry or remove the photo before saving.</Text>}
              <Button variant='subtle' onClick={discard}>Cancel and discard draft</Button>
            </Stack>
          </Fieldset>
        </form>
        {desktop && !mapOpened && <Box style={{ position: 'sticky', top: 80, height: 'min(76dvh, 760px)', alignSelf: 'start', borderRadius: 12, overflow: 'hidden' }}>{map}</Box>}
      </SimpleGrid>
      <Modal opened={mapOpened} onClose={closeMap} fullScreen title='Where is the garden?' keepMounted={false}>
        <Box h='calc(100dvh - 150px)'>{mapOpened && map}</Box><Button fullWidth mt='md' disabled={!values.position} onClick={closeMap}>Use this location</Button>
      </Modal>
    </Container>
  );
}
