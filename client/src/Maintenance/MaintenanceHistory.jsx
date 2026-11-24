import { Alert, Badge, Button, Card, Group, Image, Loader, Stack, Text, Title } from '@mantine/core';
import { Link } from 'react-router';
import { useInfiniteQuery } from '@tanstack/react-query';
import Api from '../Api';
import DeleteMaintenanceUpdate from './DeleteMaintenanceUpdate';
import { useMaintenanceCapabilities } from './maintenance-queries';

function recordDate (date) {
  return date ? new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeZone: 'UTC' }).format(new Date(`${date}T12:00:00Z`)) : 'Date not recorded';
}

export default function MaintenanceHistory ({ plot }) {
  const { capabilities: access, authPending } = useMaintenanceCapabilities();
  const capabilities = authPending ? undefined : access.data;
  const query = useInfiniteQuery({
    queryKey: ['maintenance', plot.id],
    queryFn: ({ signal, pageParam }) => Api.maintenance.index({ plotId: plot.id, offset: pageParam, pageSize: 20 }, signal),
    initialPageParam: 0,
    getNextPageParam: (response) => response.headers['x-next-offset'] ?? undefined,
  });
  const records = query.data?.pages.flatMap(({ data }) => data) ?? [];
  return (
    <Stack>
      <Title order={3}>Updates &amp; history</Title>
      {capabilities?.canCreate && ['potential', 'preparing', 'active', 'paused'].includes(plot.stage) && <Group><Button component={Link} to={`/plots/${encodeURIComponent(plot.id)}/updates/new?quick=photo`} variant='light'>Photo update</Button><Button component={Link} to={`/plots/${encodeURIComponent(plot.id)}/updates/new`}>Add an update</Button></Group>}
      <Text size='sm' c='dimmed'>Visit records describe past events. Garden care summaries and the current plant list are managed separately.</Text>
      {query.isPending && <Loader aria-label='Loading updates' />}
      {(query.isLoadingError || query.isRefetchError) && (
        <Alert color='red' role='alert'>
          {query.isRefetchError ? 'Unable to refresh updates.' : 'Unable to load updates.'}
          <Button variant='subtle' disabled={query.isFetching} onClick={() => query.refetch()}>Try again</Button>
        </Alert>
      )}
      {query.isSuccess && !records.length && <Text>No updates recorded yet.</Text>}
      {records.map((record) => (
        <Card key={record.id} withBorder component='article'>
          <Stack gap='xs'>
            <Group justify='space-between'><Text fw={600}>{recordDate(record.date)}</Text>{record.editedAt && <Badge variant='light'>Edited</Badge>}</Group>
            <Text size='sm' c='dimmed'>{record.credit}</Text>
            {!!record.activity.length && <Text>{record.activity.join(', ')}</Text>}
            {!!record.observations.length && <Text>Observed: {record.observations.join(', ')}</Text>}
            {record.notes && <Text style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{record.notes}</Text>}
            {record.planting && <Text size='sm'>{record.planting}</Text>}
            {record.plants.map((plant) => <Text key={plant.id} size='sm'>{plant.quantity == null ? '' : `${plant.quantity} × `}{plant.name || 'Plant name not recorded'}</Text>)}
            {record.photos.map((photo, index) => <Image key={photo.id} src={photo.url} alt={`Visit photo ${index + 1}`} radius='sm' loading='lazy' h={260} fit='contain' fallbackSrc='data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg" width="200" height="40"%3E%3Ctext x="10" y="25"%3EPhoto unavailable%3C/text%3E%3C/svg%3E' />)}
            {capabilities?.canManage && <Group><Button component={Link} variant='subtle' to={`/plots/${encodeURIComponent(plot.id)}/updates/${record.id}/edit`}>Edit update</Button><DeleteMaintenanceUpdate record={record} plotId={plot.id} /></Group>}
            <Text size='xs' c='dimmed'>Recorded {new Date(record.createdAt).toLocaleString()}</Text>
          </Stack>
        </Card>
      ))}
      {query.isFetchNextPageError && <Alert color='red' role='alert'>Unable to load more updates.</Alert>}
      {query.hasNextPage && (
        <Button variant='light' disabled={query.isFetching} loading={query.isFetchingNextPage} onClick={() => query.fetchNextPage()}>
          {query.isFetchNextPageError ? 'Try again' : 'Load more updates'}
        </Button>
      )}
    </Stack>
  );
}
