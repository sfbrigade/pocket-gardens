import { Alert, Badge, Button, Divider, Group, Image, List, Stack, Text, Title } from '@mantine/core';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router';

import Api from '../Api';
import { useAuthContext } from '../AuthContext';
import { canAdministerPlots, canContributeToPlots, plotPermissionLabels, plotStageLabel } from '../plots.js';
import PlotStage from './PlotStage';

export default function PlotDetails ({ plot }) {
  const { user, isPending } = useAuthContext();
  const isStaff = !isPending && canAdministerPlots(user);
  const access = useQuery({
    queryKey: ['plot-edit-access', plot.id, user?.id],
    queryFn: ({ signal }) => Api.plots.editAccess(plot.id, signal).then(({ data }) => data),
    enabled: !isPending && !isStaff && canContributeToPlots(user),
    retry: false,
  });
  const canEdit = isStaff || (!isPending && canContributeToPlots(user) && access.data?.canEdit);
  const facts = [
    ['Address', plot['Street City Address (for Maps)'] || plot['Street Address']],
    ['Look for', plot['Location Description']],
    ['Coordinates', Number.isFinite(plot.Latitude) && Number.isFinite(plot.Longitude) ? `${plot.Latitude}, ${plot.Longitude}` : null],
    ['Permission', plotPermissionLabels[plot.permissionStatus]],
    ['Additional permission note', plot.permissionAdditionalNote],
    ['Garden care note', plot.gardenCareNote],
    ['First planted', plot.firstPlanted],
    ['Bed type', plot['Bed Type']], ['Area', plot['Est. Area (Sq. Ft)'] != null ? `${plot['Est. Area (Sq. Ft)']} sq ft` : null],
    ['Sun', plot.sunExposure], ['Soil', plot['Soil Type']], ['Environmental notes', plot.environmentalNotes],
  ];
  return (
    <Stack gap='md'>
      <Group>
        <Badge color='green'>{plotStageLabel(plot.stage)}</Badge>
        {isStaff && <PlotStage key={`${user.id}:${plot.id}`} plot={plot} accountId={user.id} />}
      </Group>
      {canEdit && (
        <Group><Button component={Link} to={`/plots/${encodeURIComponent(plot.id)}/edit`} variant='light'>Edit garden details</Button></Group>
      )}
      {plot.Photos?.map((url) => <Image key={url} src={url} alt='Garden reference photo' radius='md' mah={240} fit='cover' />)}
      <Stack gap='xs'>
        {facts.filter(([, value]) => value != null && value !== '').map(([label, value]) => (
          <div key={label}><Text size='sm' c='dimmed'>{label}</Text><Text style={{ overflowWrap: 'anywhere', whiteSpace: 'pre-wrap' }}>{value}</Text></div>
        ))}
      </Stack>
      <Divider />
      <Title order={3} size='h4'>Plants</Title>
      {plot.plants?.length
        ? <List>{plot.plants.map((plant) => <List.Item key={plant.plantId}><Text>{plant.quantity != null ? `${plant.quantity} × ` : ''}{plant.plantName || plant.commonName || plant.latinName} · {plant.state}</Text>{plant.notes && <Text size='sm' c='dimmed'>{plant.notes}</Text>}</List.Item>)}</List>
        : <Text c='dimmed'>No planned or current plants recorded.</Text>}
      {!!plot.assignedVolunteers?.length && <><Title order={3} size='h4'>Who looks after it</Title><List>{plot.assignedVolunteers.map(({ id, displayName }) => <List.Item key={id}>{displayName}</List.Item>)}</List></>}
      <Alert color='gray' title='Garden ID'>{plot.id}</Alert>
    </Stack>
  );
}
