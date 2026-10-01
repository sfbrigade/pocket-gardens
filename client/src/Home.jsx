import { Container, Title } from '@mantine/core';
import { Head } from '@unhead/react';
import { lazy, Suspense } from 'react';
import 'leaflet/dist/leaflet.css';

const LeafletContainer = lazy(() => import('./Components/LeafletContainer'));

function Home () {
  return (
    <>
      <Head>
        <title>Home</title>
      </Head>
      <Container fluid p={0} style={{ height: 'calc(100dvh - var(--app-shell-header-offset) - 2 * var(--app-shell-padding))', display: 'flex', flexDirection: 'column' }}>
        <Title order={1} px='md' pt='md'>Pocket Gardens</Title>
        <div style={{ flex: 1, minHeight: 0, width: '100%', overflow: 'hidden', position: 'relative', zIndex: 0 }}>
          <Suspense fallback={<div>Loading map...</div>}>
            <LeafletContainer />
          </Suspense>
        </div>
      </Container>
    </>
  );
}

export default Home;
