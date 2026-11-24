import { Alert, Box, Button, Drawer, Group, Loader, Paper, Stack, Tabs, Title } from '@mantine/core';
import { useMediaQuery, useMounted } from '@mantine/hooks';
import { useHead } from '@unhead/react';
import { useQuery } from '@tanstack/react-query';
import { Link, useLocation, useNavigate, useParams } from 'react-router';

import Api from './Api';
import GardenMap from './Components/GardenMap';
import PlotDetails from './Plots/PlotDetails';
import MaintenanceHistory from './Maintenance/MaintenanceHistory';

export default function Home () {
  useHead({ title: 'Pocket Gardens' });
  const mounted = useMounted();
  const mobile = useMediaQuery('(max-width: 48em)', false);
  const { plotId } = useParams();
  const navigate = useNavigate();
  const location = useLocation();
  const search = new URLSearchParams(location.search);
  const activeTab = search.get('tab') === 'updates' ? 'updates' : 'info';
  function selectTab (tab) {
    if (tab === 'updates') search.set('tab', tab);
    else search.delete('tab');
    navigate({ pathname: location.pathname, search: search.toString(), hash: location.hash }, { replace: true, state: location.state });
  }
  const { data: capabilities } = useQuery({ queryKey: ['plots', 'capabilities'], queryFn: ({ signal }) => Api.plots.capabilities(signal).then(({ data }) => data), enabled: mounted });
  const { data: plot, isPending, isError, error, refetch } = useQuery({
    queryKey: ['plot', plotId],
    queryFn: ({ signal }) => Api.plots.get(plotId, signal).then(({ data }) => data),
    enabled: mounted && !!plotId,
    retry: (attempt, failure) => failure.response?.status !== 404 && attempt < 1,
  });
  const panel = (
    <Stack>
      <Group justify='space-between'><Button component={Link} to='/' variant='subtle'>Back to map</Button></Group>
      {location.state?.created && <Alert color='green' role='status'>Garden created. It is saved and on the map.</Alert>}
      {isPending && <Loader aria-label='Loading garden details' />}
      {isError && <Alert color='red' title={error.response?.status === 404 ? 'Garden not found' : 'Unable to load garden'}><Button variant='subtle' onClick={() => refetch()}>Try again</Button></Alert>}
      {plot && (
        <>
          <Title order={2}>{plot['Pocket Garden Name'] || 'Pocket garden'}</Title>
          <Tabs keepMounted={false} value={activeTab} onChange={selectTab}>
            <Tabs.List aria-label='Garden details'><Tabs.Tab value='info'>Info</Tabs.Tab><Tabs.Tab value='updates'>Updates</Tabs.Tab></Tabs.List>
            <Tabs.Panel value='info' pt='md'><PlotDetails plot={plot} /></Tabs.Panel>
            <Tabs.Panel value='updates' pt='md'><MaintenanceHistory plot={plot} /></Tabs.Panel>
          </Tabs>
        </>
      )}
    </Stack>
  );
  return (
    <Box style={{ height: 'calc(100dvh - var(--app-shell-header-offset) - 2 * var(--app-shell-padding))', display: 'flex', minHeight: 360 }}>
      {plotId && !mobile && <Paper component='aside' withBorder p='md' style={{ width: 400, maxWidth: '45%', overflowY: 'auto' }} aria-label='Garden details'>{panel}</Paper>}
      <Box style={{ flex: 1, minWidth: 0, position: 'relative', zIndex: 0 }}>
        <GardenMap selectedPlot={plot} viewportPlotId={activeTab === 'updates' ? plot?.id : undefined} onSelectPlot={(id) => navigate(`/plots/${id}`)} onCreatePlot={capabilities?.canCreatePlot ? (position) => navigate('/plots/new', { state: { mapPosition: position } }) : undefined} />
        {capabilities?.canCreatePlot && <Button component={Link} to='/plots/new' color='green' style={{ position: 'absolute', bottom: 32, left: 16, zIndex: 1000 }}>Create a garden</Button>}
      </Box>
      {mobile && <Drawer opened={!!plotId} onClose={() => navigate('/')} position='bottom' size='70%' title='Garden details'>{panel}</Drawer>}
    </Box>
  );
}
