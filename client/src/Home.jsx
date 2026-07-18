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
      <Container fluid p={0}>
        <Title order={1} px='md' pt='md'>Pocket Gardens</Title>
        <div style={{ height: 'calc(100dvh - 60px)', minHeight: 400, width: '100%', overflow: 'hidden', position: 'relative', zIndex: 0 }}>
          <Suspense fallback={<div>Loading map...</div>}>
            <LeafletContainer />
          </Suspense>
        </div>
      </Container>
    </>
  );
}

export default Home;
