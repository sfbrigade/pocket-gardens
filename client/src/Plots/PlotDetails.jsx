import { Alert, Badge, Divider, Group, Image, List, Stack, Text, Title } from '@mantine/core';

import { plotPermissionLabels, plotStageLabel } from '../plots.js';

export default function PlotDetails ({ plot }) {
  const facts = [
    ['Address', plot['Street City Address (for Maps)'] || plot['Street Address']],
    ['Look for', plot['Location Description']],
    ['Coordinates', Number.isFinite(plot.Latitude) && Number.isFinite(plot.Longitude) ? `${plot.Latitude}, ${plot.Longitude}` : null],
    ['Permission', plotPermissionLabels[plot.permissionStatus]],
    ['First planted', plot.firstPlanted],
    ['Bed type', plot['Bed Type']], ['Area', plot['Est. Area (Sq. Ft)'] != null ? `${plot['Est. Area (Sq. Ft)']} sq ft` : null],
    ['Sun', plot.sunExposure], ['Soil', plot['Soil Type']], ['Environmental notes', plot.environmentalNotes],
  ];
  return (
    <Stack gap='md'>
      <Title order={2}>{plot['Pocket Garden Name'] || 'Pocket garden'}</Title>
      <Group><Badge color='green'>{plotStageLabel(plot.stage)}</Badge></Group>
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
      {!!plot.assignedVolunteers?.length && <><Title order={3} size='h4'>Assigned volunteers</Title><List>{plot.assignedVolunteers.map(({ id, displayName }) => <List.Item key={id}>{displayName}</List.Item>)}</List></>}
      <Alert color='gray' title='Garden ID'>{plot.id}</Alert>
    </Stack>
  );
}
