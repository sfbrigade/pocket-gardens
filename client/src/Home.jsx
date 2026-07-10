import { Container, Title } from '@mantine/core';
import { Head } from '@unhead/react';
import { MapContainer } from 'react-leaflet/MapContainer';
import { TileLayer } from 'react-leaflet/TileLayer';
import { Popup } from 'react-leaflet/Popup';
import { Marker } from 'react-leaflet/Marker';
import { useMap } from 'react-leaflet/hooks';
import LeafletContainer from './Components/LeafletContainer';
import 'leaflet/dist/leaflet.css';

function Home() {
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
