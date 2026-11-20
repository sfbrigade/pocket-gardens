import { Alert, Box, Button, Drawer, Group, Loader, Paper, Stack } from '@mantine/core';
import { useMediaQuery, useMounted } from '@mantine/hooks';
import { useHead } from '@unhead/react';
import { useQuery } from '@tanstack/react-query';
import { Link, useLocation, useNavigate, useParams } from 'react-router';

import Api from './Api';
import GardenMap from './Components/GardenMap';
import PlotDetails from './Plots/PlotDetails';

export default function Home () {
  useHead({ title: 'Pocket Gardens' });
  const mounted = useMounted();
  const mobile = useMediaQuery('(max-width: 48em)', false);
  const { plotId } = useParams();
  const navigate = useNavigate();
  const location = useLocation();
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
      {plot && <PlotDetails plot={plot} />}
    </Stack>
  );
  return (
    <Box style={{ height: 'calc(100dvh - var(--app-shell-header-offset) - 2 * var(--app-shell-padding))', display: 'flex', minHeight: 360 }}>
      {plotId && !mobile && <Paper component='aside' withBorder p='md' style={{ width: 400, maxWidth: '45%', overflowY: 'auto' }} aria-label='Garden details'>{panel}</Paper>}
      <Box style={{ flex: 1, minWidth: 0, position: 'relative', zIndex: 0 }}>
        <GardenMap selectedPlot={plot} onSelectPlot={(id) => navigate(`/plots/${id}`)} onCreatePlot={capabilities?.canCreatePlot ? (position) => navigate('/plots/new', { state: { mapPosition: position } }) : undefined} />
        {capabilities?.canCreatePlot && <Button component={Link} to='/plots/new' color='green' style={{ position: 'absolute', bottom: 32, left: 16, zIndex: 1000 }}>Create a garden</Button>}
      </Box>
      {mobile && <Drawer opened={!!plotId} onClose={() => navigate('/')} position='bottom' size='70%' title='Garden details'>{panel}</Drawer>}
    </Box>
  );
}
