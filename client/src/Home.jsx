import { Container, Title } from '@mantine/core';
import { Head } from '@unhead/react';
import { lazy } from 'react';
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
          <LeafletContainer />
        </div>
      </Container>
    </>
  );
}

export default Home;
